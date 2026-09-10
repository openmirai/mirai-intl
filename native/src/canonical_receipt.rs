use std::borrow::Cow;
use unicode_normalization::is_nfc;

/// Validates canonical bytes without allocating a receipt tree. Unsupported
/// encodings require complete Node validation and never count as valid.
pub fn validate(source: &str) -> Result<bool, String> {
    let Some(json) = source.strip_suffix('\n') else {
        return Ok(false);
    };
    let mut scanner = Scanner {
        source: json,
        offset: 0,
    };
    Ok(scanner.value(0)? && scanner.offset == json.len())
}

struct Scanner<'a> {
    source: &'a str,
    offset: usize,
}

impl<'a> Scanner<'a> {
    fn byte(&self) -> Option<u8> {
        self.source.as_bytes().get(self.offset).copied()
    }

    fn take(&mut self, byte: u8) -> bool {
        if self.byte() != Some(byte) {
            return false;
        }
        self.offset += 1;
        true
    }

    fn value(&mut self, depth: usize) -> Result<bool, String> {
        if depth > 128 {
            return Err("JSON depth requires Node validation".into());
        }
        match self.byte() {
            Some(b'"') => Ok(self.string()?.is_some()),
            Some(b'{') => {
                self.offset += 1;
                if self.take(b'}') {
                    return Ok(true);
                }
                let mut prior: Option<Cow<'a, str>> = None;
                loop {
                    let Some(key) = self.string()? else {
                        return Ok(false);
                    };
                    if prior.as_ref().is_some_and(|previous| {
                        previous.encode_utf16().cmp(key.encode_utf16()) != std::cmp::Ordering::Less
                    }) {
                        return Ok(false);
                    }
                    prior = Some(key);
                    if !self.take(b':') || !self.value(depth + 1)? {
                        return Ok(false);
                    }
                    if self.take(b'}') {
                        return Ok(true);
                    }
                    if !self.take(b',') {
                        return Ok(false);
                    }
                }
            }
            Some(b'[') => {
                self.offset += 1;
                if self.take(b']') {
                    return Ok(true);
                }
                loop {
                    if !self.value(depth + 1)? {
                        return Ok(false);
                    }
                    if self.take(b']') {
                        return Ok(true);
                    }
                    if !self.take(b',') {
                        return Ok(false);
                    }
                }
            }
            Some(b'n') => Ok(self.literal("null")),
            Some(b't') => Ok(self.literal("true")),
            Some(b'f') => Ok(self.literal("false")),
            Some(b'-' | b'0'..=b'9') => {
                let start = self.offset;
                while self.byte().is_some_and(|byte| {
                    matches!(byte, b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')
                }) {
                    self.offset += 1;
                }
                let token = &self.source[start..self.offset];
                let Ok(number) = serde_json::from_str::<f64>(token) else {
                    return Ok(false);
                };
                if !number.is_finite() {
                    return Ok(false);
                }
                let mut formatter = ryu_js::Buffer::new();
                Ok(token
                    == if number == 0.0 {
                        "0"
                    } else {
                        formatter.format(number)
                    })
            }
            _ => Ok(false),
        }
    }

    fn literal(&mut self, expected: &str) -> bool {
        if self.source[self.offset..].starts_with(expected) {
            self.offset += expected.len();
            true
        } else {
            false
        }
    }

    fn string(&mut self) -> Result<Option<Cow<'a, str>>, String> {
        let start = self.offset;
        if !self.take(b'"') {
            return Ok(None);
        }
        let content = self.offset;
        let mut escaped = false;
        loop {
            match self.byte() {
                None | Some(0..=31) => return Ok(None),
                Some(b'"') => {
                    let end = self.offset;
                    self.offset += 1;
                    let raw = &self.source[start..self.offset];
                    let value = if escaped {
                        match serde_json::from_str::<String>(raw) {
                            Ok(value) => Cow::Owned(value),
                            Err(error) => {
                                return Err(format!(
                                    "String encoding requires Node validation: {error}"
                                ));
                            }
                        }
                    } else {
                        Cow::Borrowed(&self.source[content..end])
                    };
                    if !value.is_ascii() && !is_nfc(&value) {
                        return Ok(None);
                    }
                    if escaped
                        && serde_json::to_string(value.as_ref())
                            .map_err(|error| error.to_string())?
                            != raw
                    {
                        return Ok(None);
                    }
                    return Ok(Some(value));
                }
                Some(b'\\') => {
                    escaped = true;
                    self.offset += 1;
                    if self.byte().is_none() {
                        return Ok(None);
                    }
                    self.offset += 1;
                }
                Some(_) => self.offset += 1,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_noncanonical_but_preserves_unsupported_encodings() {
        for source in [
            "{}",
            "{}\n\n",
            "{ \"a\":1}\n",
            "{\"b\":1,\"a\":2}\n",
            "{\"a\":1,\"a\":1}\n",
            "[1,]\n",
            "-0\n",
            "1E+21\n",
            "\"\\u0061\"\n",
            "\"e\u{301}\"\n",
        ] {
            assert_eq!(validate(source).unwrap(), false, "{source}");
        }
        assert!(validate("\"\\ud800\"\n").is_err());
        for source in [
            "{}\n",
            "{\"a\":[true,false,null,1e+21,0]}\n",
            "\"สวัสดี😀\"\n",
            "\"\\n\\t\\b\\f\\r\\u0000\"\n",
            "{\"𐀀\":2,\"\u{e000}\":1}\n",
        ] {
            assert_eq!(validate(source).unwrap(), true, "{source}");
        }
    }
}
