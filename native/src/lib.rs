use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{self, Metadata, OpenOptions};
use std::io::Read;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;
mod canonical_receipt;
mod discovery;

pub const MAX_REQUEST_BYTES: usize = 64 * 1024 * 1024;
const MAX_FILES: usize = 16_384;

#[derive(Debug, Serialize)]
pub struct EngineError {
    pub code: String,
    pub message: String,
}

impl EngineError {
    fn unsupported_filesystem(message: impl Into<String>) -> Self {
        Self {
            code: "ERR_INTL_NATIVE_FS_UNSUPPORTED".into(),
            message: message.into(),
        }
    }
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "ERR_INTL_NATIVE_INPUT".into(),
            message: message.into(),
        }
    }
    fn io(error: std::io::Error) -> Self {
        #[cfg(unix)]
        if let Some(raw) = error.raw_os_error() {
            let code = match raw {
                libc::EIO => Some("EIO"),
                libc::ELOOP => Some("ELOOP"),
                libc::ENOTDIR => Some("ENOTDIR"),
                libc::EMFILE => Some("EMFILE"),
                libc::ENFILE => Some("ENFILE"),
                libc::ENAMETOOLONG => Some("ENAMETOOLONG"),
                _ => None,
            };
            if let Some(code) = code {
                return Self {
                    code: code.into(),
                    message: error.to_string(),
                };
            }
        }
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => "ENOENT",
            std::io::ErrorKind::PermissionDenied => "EACCES",
            _ => "ERR_INTL_NATIVE_IO",
        };
        Self {
            code: code.into(),
            message: error.to_string(),
        }
    }
}

pub fn canonical_json(source: &str) -> Result<String, String> {
    if source.len() > MAX_REQUEST_BYTES {
        return Err("JSON input exceeds native bound".into());
    }
    let value: Value = serde_json::from_str(source).map_err(|error| error.to_string())?;
    let mut output = String::with_capacity(source.len());
    encode_canonical(&value, &mut output)?;
    Ok(output)
}

fn encode_canonical(value: &Value, output: &mut String) -> Result<(), String> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => {
            let number = value.as_f64().ok_or("Number is not finite")?;
            if !number.is_finite() {
                return Err("Number is not finite".into());
            }
            if number == 0.0 {
                output.push('0');
            } else {
                output.push_str(ryu_js::Buffer::new().format(number));
            }
        }
        Value::String(value) => output.push_str(
            &serde_json::to_string(&value.nfc().collect::<String>())
                .map_err(|error| error.to_string())?,
        ),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                encode_canonical(value, output)?;
            }
            output.push(']');
        }
        Value::Object(values) => {
            let mut entries: Vec<_> = values.iter().collect();
            entries.sort_by(|(left, _), (right, _)| left.encode_utf16().cmp(right.encode_utf16()));
            output.push('{');
            for (index, (key, value)) in entries.iter().enumerate() {
                if key.nfc().collect::<String>() != **key {
                    return Err("Object key is not NFC-normalized".into());
                }
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&serde_json::to_string(key).map_err(|error| error.to_string())?);
                output.push(':');
                encode_canonical(value, output)?;
            }
            output.push('}');
        }
    }
    Ok(())
}

fn hash_hex(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut output = String::with_capacity(7 + bytes.len() * 2);
    output.push_str("sha256:");
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 15) as usize] as char);
    }
    output
}

fn digest(bytes: &[u8]) -> String {
    hash_hex(Sha256::digest(bytes).as_ref())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHash {
    path: String,
    hash: String,
    bytes: u64,
}

fn same_file(before: &Metadata, after: &Metadata) -> bool {
    if !after.is_file()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev()
            || before.ino() != after.ino()
            || before.ctime() != after.ctime()
            || before.ctime_nsec() != after.ctime_nsec()
        {
            return false;
        }
    }
    true
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HashFileTestPhase {
    BeforeOpen,
    AfterRead(u64),
}

pub fn hash_file(path: &str, utf8: bool) -> Result<FileHash, EngineError> {
    hash_file_observed(
        path,
        utf8,
        #[cfg(test)]
        &mut |_| {},
    )
}

// Test hooks are compiled out of production, including the callback argument.
fn hash_file_observed(
    path: &str,
    utf8: bool,
    #[cfg(test)] observe: &mut dyn FnMut(HashFileTestPhase),
) -> Result<FileHash, EngineError> {
    let before = fs::symlink_metadata(path).map_err(EngineError::io)?;
    if !before.is_file() || before.file_type().is_symlink() {
        return Err(EngineError::invalid(
            "Receipt input must be a non-symlink regular file",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(test)]
    observe(HashFileTestPhase::BeforeOpen);
    let mut file = options.open(path).map_err(EngineError::io)?;
    if !same_file(&before, &file.metadata().map_err(EngineError::io)?) {
        return Err(EngineError::invalid("File changed before reading"));
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 128 * 1024];
    let mut carry: Vec<u8> = Vec::with_capacity(4);
    let mut bytes = 0u64;
    loop {
        let prefix = carry.len();
        buffer[..prefix].copy_from_slice(&carry);
        let read = file.read(&mut buffer[prefix..]).map_err(EngineError::io)?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        if bytes > before.len() {
            return Err(EngineError::invalid("File grew during reading"));
        }
        hasher.update(&buffer[prefix..prefix + read]);
        #[cfg(test)]
        observe(HashFileTestPhase::AfterRead(bytes));
        if utf8 {
            match std::str::from_utf8(&buffer[..prefix + read]) {
                Ok(_) => carry.clear(),
                Err(error) if error.error_len().is_none() => {
                    carry.clear();
                    carry.extend_from_slice(&buffer[error.valid_up_to()..prefix + read]);
                }
                Err(_) => return Err(EngineError::invalid("Receipt input must be valid UTF-8")),
            }
        }
    }
    if !carry.is_empty() {
        return Err(EngineError::invalid(
            "Receipt input ends with incomplete UTF-8",
        ));
    }
    let after = fs::symlink_metadata(path).map_err(EngineError::io)?;
    if !same_file(&before, &after)
        || !same_file(&before, &file.metadata().map_err(EngineError::io)?)
        || bytes != before.len()
    {
        return Err(EngineError::invalid("File changed during reading"));
    }
    Ok(FileHash {
        path: path.into(),
        hash: hash_hex(hasher.finalize().as_ref()),
        bytes,
    })
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    HashFiles { paths: Vec<String>, utf8: bool },
    CanonicalJson { source: String },
    CanonicalReceipt { source: String },
    DiscoverCatalogs { root: String },
    DiscoverSources { root: String, generated: String },
    Classify { source: String, path: String },
}

pub struct Engine {
    pool: rayon::ThreadPool,
}

impl Engine {
    pub fn new(workers: usize) -> Result<Self, EngineError> {
        if !(1..=16).contains(&workers) {
            return Err(EngineError::invalid("Worker count must be from 1 to 16"));
        }
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(workers)
            .build()
            .map_err(|error| EngineError::invalid(error.to_string()))?;
        Ok(Self { pool })
    }

    pub fn execute(&self, source: &str) -> String {
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.request(source)));
        match result {
            Ok(Ok(value)) => json!({ "ok": true, "result": value }).to_string(),
            Ok(Err(error)) => json!({ "ok": false, "error": error }).to_string(),
            Err(_) => json!({ "ok": false, "error": { "code": "ERR_INTL_NATIVE_INTERNAL", "message": "Native operation panicked" } }).to_string(),
        }
    }

    fn request(&self, source: &str) -> Result<Value, EngineError> {
        if source.len() > MAX_REQUEST_BYTES {
            return Err(EngineError::invalid("Request exceeds native byte bound"));
        }
        let request: Request = serde_json::from_str(source)
            .map_err(|error| EngineError::invalid(error.to_string()))?;
        match request {
            Request::HashFiles { paths, utf8 } => {
                if paths.len() > MAX_FILES
                    || paths.iter().any(|path| !Path::new(path).is_absolute())
                {
                    return Err(EngineError::invalid(
                        "File batch exceeds bound or contains a relative path",
                    ));
                }
                let results: Vec<Value> = self.pool.install(|| {
                    paths
                        .par_iter()
                        .map(|path| match hash_file(path, utf8) {
                            Ok(value) => json!({ "ok": true, "value": value }),
                            Err(error) => json!({ "ok": false, "path": path, "error": error }),
                        })
                        .collect()
                });
                Ok(json!({ "files": results }))
            }
            Request::CanonicalJson { source } => {
                let canonical = canonical_json(&source).map_err(|message| EngineError {
                    code: "ERR_INTL_NATIVE_JSON_UNSUPPORTED".into(),
                    message,
                })?;
                Ok(
                    json!({ "canonical": canonical, "hash": digest(canonical.as_bytes()), "sourceHash": digest(source.as_bytes()) }),
                )
            }
            Request::CanonicalReceipt { source } => {
                let canonical =
                    canonical_receipt::validate(&source).map_err(|message| EngineError {
                        code: "ERR_INTL_NATIVE_JSON_UNSUPPORTED".into(),
                        message,
                    })?;
                Ok(json!({ "canonical": canonical, "hash": digest(source.as_bytes()) }))
            }
            Request::Classify { source, path } => classify(&source, &path),
            Request::DiscoverCatalogs { root } => {
                Ok(json!({ "paths": discovery::catalogs(&root)? }))
            }
            Request::DiscoverSources { root, generated } => {
                Ok(json!({ "paths": discovery::sources(&root, &generated)? }))
            }
        }
    }
}

#[cfg(feature = "oxc")]
fn classify(source: &str, path: &str) -> Result<Value, EngineError> {
    let allocator = oxc_allocator::Allocator::default();
    let source_type = oxc_span::SourceType::from_path(path)
        .map_err(|error| EngineError::invalid(error.to_string()))?;
    let result = oxc_parser::Parser::new(&allocator, source, source_type).parse();
    // Parser evidence only. TypeScript semantic authorization is never bypassed.
    Ok(
        json!({ "diagnostics": result.diagnostics.len(), "requiresTypeScript": true, "statements": result.program.body.len() }),
    )
}

#[cfg(not(feature = "oxc"))]
fn classify(_source: &str, _path: &str) -> Result<Value, EngineError> {
    Err(EngineError {
        code: "ERR_INTL_NATIVE_OXC_UNAVAILABLE".into(),
        message: "Oxc evaluation was not built".into(),
    })
}

#[cfg(feature = "addon")]
mod addon {
    use super::{Engine, MAX_REQUEST_BYTES};
    use napi::{Env, Task, bindgen_prelude::AsyncTask};
    use napi_derive::napi;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[napi]
    pub struct NativeEngine {
        inner: Option<Arc<Engine>>,
        busy: Arc<AtomicBool>,
    }

    #[napi]
    impl NativeEngine {
        #[napi(constructor)]
        pub fn new(workers: u32) -> napi::Result<Self> {
            Ok(Self {
                inner: Some(Arc::new(
                    Engine::new(workers as usize)
                        .map_err(|error| napi::Error::from_reason(error.message))?,
                )),
                busy: Arc::new(AtomicBool::new(false)),
            })
        }

        #[napi]
        pub fn execute(&self, source: String) -> napi::Result<AsyncTask<EngineTask>> {
            let engine = self
                .inner
                .as_ref()
                .ok_or_else(|| napi::Error::from_reason("Native engine is closed"))?;
            if source.len() > MAX_REQUEST_BYTES {
                return Err(napi::Error::from_reason(
                    "Native request exceeds byte bound",
                ));
            }
            if self
                .busy
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                return Err(napi::Error::from_reason(
                    "Native operation already in flight",
                ));
            }
            Ok(AsyncTask::new(EngineTask {
                engine: engine.clone(),
                source,
                busy: self.busy.clone(),
            }))
        }

        #[napi]
        pub fn close(&mut self) -> napi::Result<()> {
            if self.busy.load(Ordering::Acquire) {
                return Err(napi::Error::from_reason(
                    "Native operation already in flight",
                ));
            }
            self.inner.take();
            Ok(())
        }
    }

    #[napi]
    pub fn engine_abi() -> &'static str {
        "mirai-intl-native-v1"
    }

    #[napi]
    pub fn unicode_version() -> String {
        let (major, minor, _) = unicode_normalization::UNICODE_VERSION;
        format!("{major}.{minor}")
    }

    pub struct EngineTask {
        engine: Arc<Engine>,
        source: String,
        busy: Arc<AtomicBool>,
    }

    impl Drop for EngineTask {
        fn drop(&mut self) {
            self.busy.store(false, Ordering::Release);
        }
    }

    impl Task for EngineTask {
        type Output = String;
        type JsValue = String;
        fn compute(&mut self) -> napi::Result<Self::Output> {
            Ok(self.engine.execute(&self.source))
        }
        fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
            Ok(output)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_byte_parity() {
        assert_eq!(
            canonical_json(r#"{"z":-0,"a":"e\u0301","n":1e21}"#).unwrap(),
            "{\"a\":\"é\",\"n\":1e+21,\"z\":0}"
        );
    }

    #[test]
    fn utf16_key_order() {
        assert_eq!(
            canonical_json("{\"\u{e000}\":1,\"\u{10000}\":2}").unwrap(),
            "{\"\u{10000}\":2,\"\u{e000}\":1}"
        );
    }

    #[test]
    fn rejects_non_nfc_keys_and_nonfinite_numbers() {
        assert!(canonical_json(r#"{"e\u0301":1}"#).is_err());
        assert!(canonical_json("1e400").is_err());
    }

    #[test]
    fn rejects_unbounded_workers() {
        assert!(Engine::new(0).is_err());
        assert!(Engine::new(17).is_err());
    }

    #[test]
    fn hashing_streams_split_utf8_and_preserves_all_failures() {
        let root = std::env::temp_dir().join(format!(
            "mirai-native-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let source = root.join("source.txt");
        let mut bytes = vec![b'a'; 128 * 1024 - 1];
        bytes.extend_from_slice("สวัสดี".as_bytes());
        fs::write(&source, &bytes).unwrap();
        assert_eq!(
            hash_file(source.to_str().unwrap(), true).unwrap().hash,
            digest(&bytes)
        );
        let engine = Engine::new(2).unwrap();
        let report: Value = serde_json::from_str(&engine.execute(&json!({ "operation": "hashFiles", "paths": [source, root.join("missing")], "utf8": true }).to_string())).unwrap();
        assert_eq!(report["result"]["files"][0]["ok"], true);
        assert_eq!(report["result"]["files"][1]["error"]["code"], "ENOENT");
        fs::write(&source, [0xf0, 0x9f]).unwrap();
        assert!(hash_file(source.to_str().unwrap(), true).is_err());
        assert!(hash_file(source.to_str().unwrap(), false).is_ok());
        #[cfg(unix)]
        {
            let link = root.join("link");
            std::os::unix::fs::symlink(&source, &link).unwrap();
            assert!(hash_file(link.to_str().unwrap(), false).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    struct HashFixture(std::path::PathBuf);

    #[cfg(unix)]
    impl HashFixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "mirai-native-hash-regression-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }

    #[cfg(unix)]
    impl Drop for HashFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    #[test]
    fn hashing_rejects_fifo_replacement_without_blocking() {
        use std::os::unix::ffi::OsStrExt;
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};
        const CHILD_ROOT: &str = "MIRAI_INTL_TEST_FIFO_CHILD_ROOT";
        if let Some(root) = std::env::var_os(CHILD_ROOT) {
            let path = std::path::PathBuf::from(root).join("source");
            let mut before_open = false;
            let error = hash_file_observed(path.to_str().unwrap(), false, &mut |phase| {
                assert_eq!(phase, HashFileTestPhase::BeforeOpen);
                before_open = true;
                fs::remove_file(&path).unwrap();
                let name = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
                // No writer ever opens this FIFO: a blocking read-open must time out.
                assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
            })
            .err()
            .expect("replaced FIFO must never yield a file hash");
            assert!(before_open);
            assert_eq!(error.code, "ERR_INTL_NATIVE_INPUT");
            assert_eq!(error.message, "File changed before reading");
            return;
        }
        let fixture = HashFixture::new();
        fs::write(fixture.0.join("source"), b"original").unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::hashing_rejects_fifo_replacement_without_blocking",
                "--nocapture",
            ])
            .env(CHILD_ROOT, &fixture.0)
            .stdin(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success(), "FIFO regression child failed: {status}");
                break;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("FIFO replacement blocked read-open beyond the two-second watchdog");
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[cfg(unix)]
    #[test]
    fn hashing_rejects_same_size_rewrite_even_with_restored_mtime() {
        use std::io::Write;
        use std::os::unix::fs::MetadataExt;
        use std::time::{Duration, Instant};
        let fixture = HashFixture::new();
        let path = fixture.0.join("source");
        fs::write(&path, vec![b'a'; 256 * 1024]).unwrap();
        let initial = fs::metadata(&path).unwrap();
        let mut rewritten = false;
        let error = hash_file_observed(path.to_str().unwrap(), false, &mut |phase| {
            if !matches!(phase, HashFileTestPhase::AfterRead(_)) || rewritten {
                return;
            }
            rewritten = true;
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let mut writer = OpenOptions::new().write(true).open(&path).unwrap();
                writer.write_all(b"changed!").unwrap();
                writer
                    .set_times(fs::FileTimes::new().set_modified(initial.modified().unwrap()))
                    .unwrap();
                let after = writer.metadata().unwrap();
                assert_eq!(after.len(), initial.len());
                assert_eq!(after.modified().unwrap(), initial.modified().unwrap());
                assert_eq!((after.dev(), after.ino()), (initial.dev(), initial.ino()));
                if (after.ctime(), after.ctime_nsec()) != (initial.ctime(), initial.ctime_nsec()) {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "filesystem did not expose changed ctime"
                );
                std::thread::sleep(Duration::from_millis(1));
            }
        })
        .err()
        .expect("a rewrite of already-read bytes must invalidate the hash");
        assert!(rewritten);
        assert_eq!(error.code, "ERR_INTL_NATIVE_INPUT");
        assert_eq!(error.message, "File changed during reading");
    }

    #[cfg(unix)]
    #[test]
    fn hashing_rejects_growth_before_accepting_an_extra_chunk() {
        use std::io::Write;
        let fixture = HashFixture::new();
        let path = fixture.0.join("source");
        fs::write(&path, vec![b'a'; 128 * 1024]).unwrap();
        let mut observations = Vec::new();
        let error = hash_file_observed(path.to_str().unwrap(), false, &mut |phase| {
            if let HashFileTestPhase::AfterRead(bytes) = phase {
                observations.push(bytes);
                // Append once so even removal of the production guard cannot hang this test.
                if observations.len() == 1 {
                    OpenOptions::new()
                        .append(true)
                        .open(&path)
                        .unwrap()
                        .write_all(b"x")
                        .unwrap();
                }
            }
        })
        .err()
        .expect("growth must stop the streaming read");
        assert_eq!(error.code, "ERR_INTL_NATIVE_INPUT");
        assert_eq!(error.message, "File grew during reading");
        assert_eq!(observations, [128 * 1024]);
    }

    #[cfg(unix)]
    #[test]
    fn hashing_preserves_unix_fault_codes_in_mixed_batches() {
        for (errno, expected) in [
            (libc::ENOENT, "ENOENT"),
            (libc::EACCES, "EACCES"),
            (libc::EIO, "EIO"),
            (libc::ELOOP, "ELOOP"),
            (libc::ENOTDIR, "ENOTDIR"),
            (libc::EMFILE, "EMFILE"),
            (libc::ENFILE, "ENFILE"),
            (libc::ENAMETOOLONG, "ENAMETOOLONG"),
        ] {
            let error = EngineError::io(std::io::Error::from_raw_os_error(errno));
            assert_eq!(error.code, expected);
            let encoded = serde_json::to_value(error).unwrap();
            assert_eq!(encoded["code"], expected);
            assert!(!encoded["message"].as_str().unwrap().is_empty());
        }
        let fixture = HashFixture::new();
        let good = fixture.0.join("source");
        let looped = fixture.0.join("loop");
        fs::write(&good, b"hello").unwrap();
        std::os::unix::fs::symlink("loop", &looped).unwrap();
        let paths = [
            good.clone(),
            good.join("child"),
            looped.join("child"),
            fixture.0.join("missing"),
        ];
        let report: Value =
            serde_json::from_str(&Engine::new(2).unwrap().execute(
                &json!({"operation": "hashFiles", "paths": paths, "utf8": true}).to_string(),
            ))
            .unwrap();
        assert_eq!(report["ok"], true);
        let files = report["result"]["files"].as_array().unwrap();
        assert_eq!(files.len(), 4);
        assert_eq!(files[0]["value"]["hash"], digest(b"hello"));
        for (index, code) in [(1, "ENOTDIR"), (2, "ELOOP"), (3, "ENOENT")] {
            assert_eq!(files[index]["ok"], false);
            assert_eq!(files[index]["error"]["code"], code);
            assert_eq!(files[index]["path"], paths[index].to_str().unwrap());
        }
    }
}
