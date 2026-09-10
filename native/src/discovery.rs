use crate::EngineError;
use std::fs;
use std::path::{Path, PathBuf};

const SKIP: &[&str] = &[
    ".git",
    ".mirai-intl",
    ".next",
    ".turbo",
    "coverage",
    "dist",
    "node_modules",
];

fn metadata(path: &Path) -> Result<Option<fs::Metadata>, EngineError> {
    match fs::symlink_metadata(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(EngineError::io(error)),
    }
}

fn catalog(directory: &Path) -> Result<bool, EngineError> {
    if metadata(&directory.join("mirai-intl.config.json"))?
        .is_some_and(|entry| entry.is_file() && !entry.file_type().is_symlink())
    {
        return Ok(true);
    }
    for path in ["src/locales", "locales"] {
        if metadata(&directory.join(path))?
            .is_some_and(|entry| entry.is_dir() && !entry.file_type().is_symlink())
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Discovery returns paths only. Node retains project ownership, TypeScript
/// resolution and source semantics, and applies its existing output ordering.
pub fn catalogs(root: &str) -> Result<Vec<String>, EngineError> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err(EngineError::invalid("Discovery root must be absolute"));
    }
    let mut pending: Vec<(PathBuf, usize)> = vec![(root.into(), 0)];
    let mut result = Vec::new();
    let mut visited = 0usize;
    while let Some((directory, depth)) = pending.pop() {
        if depth > 256 {
            return Err(EngineError::unsupported_filesystem(
                "Directory depth exceeds native discovery bound",
            ));
        }
        if directory != root && catalog(&directory)? {
            result.push(
                directory
                    .to_str()
                    .ok_or_else(|| EngineError::unsupported_filesystem("Non-UTF8 path"))?
                    .into(),
            );
            continue;
        }
        for entry in fs::read_dir(&directory).map_err(EngineError::io)? {
            let entry = entry.map_err(EngineError::io)?;
            visited += 1;
            if visited > 500_000 {
                return Err(EngineError::unsupported_filesystem(
                    "Entry count exceeds native discovery bound",
                ));
            }
            let file_type = entry.file_type().map_err(EngineError::io)?;
            if !file_type.is_dir() || file_type.is_symlink() {
                continue;
            }
            let file_name = entry.file_name();
            let name = file_name
                .to_str()
                .ok_or_else(|| EngineError::unsupported_filesystem("Non-UTF8 directory name"))?;
            if name.starts_with('.') || SKIP.contains(&name) {
                continue;
            }
            pending.push((entry.path(), depth + 1));
        }
    }
    Ok(result)
}

/// Match source-discovery.ts's candidate inventory; project ownership and all
/// semantic decisions remain in TypeScript. Each call observes the tree afresh.
pub fn sources(root: &str, generated: &str) -> Result<Vec<String>, EngineError> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err(EngineError::invalid(
            "Source discovery root must be absolute",
        ));
    }
    let generated = generated.replace(['/', '\\'], std::path::MAIN_SEPARATOR_STR);
    let generated_children = format!("{generated}{}", std::path::MAIN_SEPARATOR);
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let mut visited = 0usize;
    let mut result = Vec::new();
    while let Some((directory, depth)) = pending.pop() {
        if depth > 256 {
            return Err(EngineError::unsupported_filesystem(
                "Source directory depth exceeds native bound",
            ));
        }
        for entry in fs::read_dir(&directory).map_err(EngineError::io)? {
            let entry = entry.map_err(EngineError::io)?;
            visited += 1;
            if visited > 500_000 {
                return Err(EngineError::unsupported_filesystem(
                    "Source entry count exceeds native bound",
                ));
            }
            let kind = entry.file_type().map_err(EngineError::io)?;
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name();
            let name = name
                .to_str()
                .ok_or_else(|| EngineError::unsupported_filesystem("Non-UTF8 source entry name"))?;
            if kind.is_dir() && name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|_| EngineError::invalid("Source path escapes root"))?;
            let relative = relative
                .to_str()
                .ok_or_else(|| EngineError::unsupported_filesystem("Non-UTF8 source path"))?;
            if relative == generated || relative.starts_with(&generated_children) {
                continue;
            }
            if kind.is_dir() {
                if [
                    ".git",
                    ".next",
                    ".turbo",
                    ".vercel",
                    "coverage",
                    "dist",
                    "node_modules",
                ]
                .contains(&name)
                {
                    continue;
                }
                pending.push((path, depth + 1));
            } else if kind.is_file()
                && [
                    ".js", ".jsx", ".ts", ".tsx", ".cjs", ".cjsx", ".cts", ".ctsx", ".mjs",
                    ".mjsx", ".mts", ".mtsx",
                ]
                .iter()
                .any(|suffix| name.ends_with(suffix))
            {
                result.push(
                    path.to_str()
                        .ok_or_else(|| EngineError::unsupported_filesystem("Non-UTF8 source path"))?
                        .into(),
                );
            }
        }
    }
    Ok(result)
}
