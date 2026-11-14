use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
pub struct ExecManager {
    pub spawned_pids: Mutex<HashSet<u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub fn validate_allowed_binary(cmd: &str) -> Result<PathBuf, String> {
    if cmd.is_empty() {
        return Err("Command cannot be empty".to_string());
    }
    if cmd.contains('\0') {
        return Err("Command cannot contain null bytes".to_string());
    }
    let path = Path::new(cmd);
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Path traversal ('..') is not allowed".to_string());
    }

    const ALLOWED_NAMES: &[&str] = &["claude", "claude.exe", "cliproxyapi", "cliproxyapi.exe"];

    let file_name = path
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| "Invalid command name".to_string())?;

    if !ALLOWED_NAMES.contains(&file_name) {
        return Err(format!("Binary '{file_name}' is not in the allowed list"));
    }

    if path.is_absolute() {
        if !path.is_file() {
            return Err(format!("Path '{}' does not exist or is not a file", cmd));
        }
        let canonical = std::fs::canonicalize(path)
            .map_err(|e| format!("Failed to canonicalize path '{}': {e}", cmd))?;
        if !canonical.is_file() {
            return Err(format!(
                "Canonical path '{}' is not a file",
                canonical.display()
            ));
        }
        let canonical_name = canonical
            .file_name()
            .and_then(|f| f.to_str())
            .ok_or_else(|| "Invalid canonical binary name".to_string())?;
        if !ALLOWED_NAMES.contains(&canonical_name) {
            return Err(format!(
                "Canonical binary '{canonical_name}' is not in the allowed list"
            ));
        }
        return Ok(canonical);
    }

    if ALLOWED_NAMES.contains(&cmd) {
        let mut search_dirs = Vec::new();
        if let Some(path_var) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path_var) {
                search_dirs.push(dir);
            }
        }
        search_dirs.push(PathBuf::from("/opt/homebrew/bin"));
        search_dirs.push(PathBuf::from("/usr/local/bin"));

        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            let home_path = Path::new(&home);
            search_dirs.push(home_path.join(".local/bin"));
            search_dirs.push(home_path.join(".claude/local"));
            search_dirs.push(home_path.join(".npm-global/bin"));
            search_dirs.push(home_path.join("bin"));
        }

        for dir in search_dirs {
            let candidate = dir.join(cmd);
            if candidate.is_file() {
                if let Ok(canonical) = std::fs::canonicalize(&candidate) {
                    if canonical.is_file() {
                        let canonical_name =
                            canonical.file_name().and_then(|f| f.to_str()).unwrap_or("");
                        if ALLOWED_NAMES.contains(&canonical_name) {
                            return Ok(canonical);
                        }
                    }
                }
            }
        }
        return Err(format!(
            "Executable '{}' not found in allowed directories",
            cmd
        ));
    }

    Err(format!("Relative paths are not allowed: '{cmd}'"))
}

pub fn validate_allowed_binary_outside_dirs(
    cmd: &str,
    forbidden_dirs: &[PathBuf],
) -> Result<PathBuf, String> {
    let canonical = validate_allowed_binary(cmd)?;
    for dir in forbidden_dirs {
        let check_dir = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.clone());
        if canonical.starts_with(&check_dir) {
            return Err(format!(
                "Refusing to execute binary inside application data directory: '{}'",
                canonical.display()
            ));
        }
    }
    Ok(canonical)
}

pub fn is_safe_exec_env_key(key: &str) -> bool {
    if key.is_empty() || key.contains('=') || key.contains('\0') {
        return false;
    }
    let upper = key.to_ascii_uppercase();
    if upper.starts_with("LD_") || upper.starts_with("DYLD_") {
        return false;
    }
    !matches!(
        upper.as_str(),
        "NODE_OPTIONS"
            | "ELECTRON_RUN_AS_NODE"
            | "BASH_ENV"
            | "ENV"
            | "PYTHONSTARTUP"
            | "PYTHONPATH"
            | "RUBYOPT"
            | "PERL5OPT"
    )
}

#[cfg(not(target_os = "ios"))]
pub mod desktop {
    use super::*;
    use std::collections::HashMap;
    use std::process::{Child, Command, Stdio};
    use std::sync::{Mutex, OnceLock};

    static DAEMON_REGISTRY: OnceLock<Mutex<HashMap<u32, Child>>> = OnceLock::new();

    fn get_daemon_registry() -> &'static Mutex<HashMap<u32, Child>> {
        DAEMON_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub async fn lh_spawn_daemon(
        state: &ExecManager,
        cmd: String,
        args: Vec<String>,
    ) -> Result<u32, String> {
        lh_spawn_daemon_checked(state, cmd, args, &[]).await
    }

    pub async fn lh_spawn_daemon_checked(
        state: &ExecManager,
        cmd: String,
        args: Vec<String>,
        forbidden_dirs: &[PathBuf],
    ) -> Result<u32, String> {
        let bin = validate_allowed_binary_outside_dirs(&cmd, forbidden_dirs)?;
        let mut command = Command::new(&bin);
        command.args(&args);
        command.stdin(Stdio::null());
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());

        let child = command.spawn().map_err(|e| e.to_string())?;
        let pid = child.id();

        let registry = get_daemon_registry();
        let mut map = registry.lock().map_err(|e| e.to_string())?;
        map.insert(pid, child);

        state
            .spawned_pids
            .lock()
            .map_err(|e| e.to_string())?
            .insert(pid);

        Ok(pid)
    }

    pub async fn lh_kill_daemon(state: &ExecManager, pid: u32) -> Result<(), String> {
        let removed = state
            .spawned_pids
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&pid);
        if !removed {
            return Err(format!("Refusing to kill untracked process PID {pid}"));
        }

        let registry = get_daemon_registry();
        let mut map = registry.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = map.remove(&pid) {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }

    pub async fn lh_exec_command(
        cmd: String,
        args: Vec<String>,
        env: Option<Vec<(String, String)>>,
        timeout_ms: Option<u64>,
    ) -> Result<ExecResult, String> {
        lh_exec_command_checked(cmd, args, env, timeout_ms, &[]).await
    }

    pub async fn lh_exec_command_checked(
        cmd: String,
        args: Vec<String>,
        env: Option<Vec<(String, String)>>,
        timeout_ms: Option<u64>,
        forbidden_dirs: &[PathBuf],
    ) -> Result<ExecResult, String> {
        let bin = validate_allowed_binary_outside_dirs(&cmd, forbidden_dirs)?;
        let mut command = tokio::process::Command::new(&bin);
        command.kill_on_drop(true);
        command.args(args);
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        if let Some(env_vars) = env {
            for (k, v) in env_vars {
                if !is_safe_exec_env_key(&k) {
                    return Err(format!("Forbidden environment variable: {k}"));
                }
                command.env(k, v);
            }
        }

        let timeout_duration = std::time::Duration::from_millis(timeout_ms.unwrap_or(30_000));
        let child = command.spawn().map_err(|e| e.to_string())?;

        match tokio::time::timeout(timeout_duration, child.wait_with_output()).await {
            Ok(Ok(output)) => Ok(ExecResult {
                code: output.status.code(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            }),
            Ok(Err(e)) => Err(e.to_string()),
            Err(_) => Err("Command execution timed out".to_string()),
        }
    }
}

#[tauri::command]
pub async fn lh_spawn_daemon(
    app: tauri::AppHandle,
    state: tauri::State<'_, ExecManager>,
    cmd: String,
    args: Vec<String>,
) -> Result<u32, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, state, cmd, args);
        Err("Subprocess execution is not supported on iOS".into())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let (data_dir, _, user_data_dir) = crate::fs_bridge::resolve_app_dirs(&app);
        desktop::lh_spawn_daemon_checked(&state, cmd, args, &[data_dir, user_data_dir]).await
    }
}

#[tauri::command]
pub async fn lh_kill_daemon(state: tauri::State<'_, ExecManager>, pid: u32) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (state, pid);
        Err("Subprocess execution is not supported on iOS".into())
    }
    #[cfg(not(target_os = "ios"))]
    {
        desktop::lh_kill_daemon(&state, pid).await
    }
}

#[tauri::command]
pub async fn lh_kill_process(state: tauri::State<'_, ExecManager>, pid: u32) -> Result<(), String> {
    lh_kill_daemon(state, pid).await
}

#[tauri::command]
pub async fn lh_exec_command(
    app: tauri::AppHandle,
    cmd: String,
    args: Vec<String>,
    env: Option<Vec<(String, String)>>,
    timeout_ms: Option<u64>,
) -> Result<ExecResult, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = (app, cmd, args, env, timeout_ms);
        Err("Subprocess execution is not supported on iOS".into())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let (data_dir, _, user_data_dir) = crate::fs_bridge::resolve_app_dirs(&app);
        desktop::lh_exec_command_checked(cmd, args, env, timeout_ms, &[data_dir, user_data_dir])
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_allowed_binary_rejects_disallowed() {
        assert!(validate_allowed_binary("").is_err());
        assert!(validate_allowed_binary("/bin/sh").is_err());
        assert!(validate_allowed_binary("sh").is_err());
        assert!(validate_allowed_binary("python3").is_err());
        assert!(validate_allowed_binary("../claude").is_err());
        assert!(validate_allowed_binary("claude\0").is_err());
        assert!(validate_allowed_binary("/path/to/../claude").is_err());
        assert!(validate_allowed_binary("subdir/claude").is_err());
    }

    #[test]
    fn test_validate_allowed_binary_accepts_valid_temp_binary() {
        let temp_dir = std::env::temp_dir().join(format!("lh_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let claude_path = temp_dir.join("claude");
        std::fs::write(&claude_path, b"#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&claude_path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let cliproxy_path = temp_dir.join("cliproxyapi");
        std::fs::write(&cliproxy_path, b"#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&cliproxy_path, std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }

        let validated_claude = validate_allowed_binary(claude_path.to_str().unwrap());
        assert!(validated_claude.is_ok());
        assert_eq!(
            validated_claude.unwrap(),
            claude_path.canonicalize().unwrap()
        );

        let validated_cliproxy = validate_allowed_binary(cliproxy_path.to_str().unwrap());
        assert!(validated_cliproxy.is_ok());
        assert_eq!(
            validated_cliproxy.unwrap(),
            cliproxy_path.canonicalize().unwrap()
        );

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[tokio::test]
    async fn daemon_spawn_track_and_kill() {
        let temp_dir = std::env::temp_dir().join(format!("lh_daemon_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let fake_claude = temp_dir.join("claude");
        std::fs::write(&fake_claude, b"#!/bin/sh\nsleep 10\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake_claude, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let manager = ExecManager::default();
        let pid =
            desktop::lh_spawn_daemon(&manager, fake_claude.to_str().unwrap().to_string(), vec![])
                .await
                .expect("spawn daemon succeeds");
        assert!(pid > 0);

        // Untracked pid should fail
        let bad_kill = desktop::lh_kill_daemon(&manager, 9999999).await;
        assert!(bad_kill.is_err());
        assert!(bad_kill
            .unwrap_err()
            .contains("Refusing to kill untracked process"));

        // Tracked pid succeeds
        let kill_res = desktop::lh_kill_daemon(&manager, pid).await;
        assert!(kill_res.is_ok());

        // Second kill of the same pid fails because it's no longer tracked
        let kill_again = desktop::lh_kill_daemon(&manager, pid).await;
        assert!(kill_again.is_err());

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_validate_allowed_binary_rejects_symlink_to_disallowed_target_and_forbidden_dirs() {
        let temp_dir =
            std::env::temp_dir().join(format!("lh_symlink_exec_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let real_sh = temp_dir.join("not_allowed");
        std::fs::write(&real_sh, b"#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&real_sh, std::fs::Permissions::from_mode(0o755)).unwrap();
            let symlink_claude = temp_dir.join("claude");
            std::os::unix::fs::symlink(&real_sh, &symlink_claude).unwrap();
            let res = validate_allowed_binary(symlink_claude.to_str().unwrap());
            assert!(res.is_err(), "symlink to non-allowed binary must fail");
        }

        let allowed_in_forbidden = temp_dir.join("cliproxyapi");
        std::fs::write(&allowed_in_forbidden, b"#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                &allowed_in_forbidden,
                std::fs::Permissions::from_mode(0o755),
            )
            .unwrap();
        }
        let forbidden_res = validate_allowed_binary_outside_dirs(
            allowed_in_forbidden.to_str().unwrap(),
            std::slice::from_ref(&temp_dir),
        );
        assert!(
            forbidden_res.is_err(),
            "binary inside forbidden app dir must fail"
        );

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_is_safe_exec_env_key() {
        assert!(is_safe_exec_env_key("PATH"));
        assert!(is_safe_exec_env_key("HOME"));
        assert!(is_safe_exec_env_key("ANTHROPIC_API_KEY"));
        assert!(!is_safe_exec_env_key(""));
        assert!(!is_safe_exec_env_key("FOO=BAR"));
        assert!(!is_safe_exec_env_key("LD_PRELOAD"));
        assert!(!is_safe_exec_env_key("ld_library_path"));
        assert!(!is_safe_exec_env_key("DYLD_INSERT_LIBRARIES"));
        assert!(!is_safe_exec_env_key("NODE_OPTIONS"));
        assert!(!is_safe_exec_env_key("ELECTRON_RUN_AS_NODE"));
        assert!(!is_safe_exec_env_key("BASH_ENV"));
    }
}
