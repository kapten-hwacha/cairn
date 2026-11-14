pub mod chats;
pub mod graph;
pub mod helpers;
pub mod jobs;
pub mod kv;
pub mod schema;

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
    pub data_dir: PathBuf,
    pub auth_file: PathBuf,
    pub user_data_dir: PathBuf,
}

pub fn open_and_init_db(
    db_path: &Path,
    data_dir: &Path,
    auth_file: &Path,
    user_data_dir: &Path,
) -> Result<DbState, String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create database directory {}: {e}",
                parent.display()
            )
        })?;
    }

    let mut conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open SQLite database {}: {e}", db_path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if db_path.exists() {
            let _ = std::fs::set_permissions(db_path, std::fs::Permissions::from_mode(0o600));
        }
        if auth_file.exists() {
            let _ = std::fs::set_permissions(auth_file, std::fs::Permissions::from_mode(0o600));
        }
    }

    // Spec §2.1 Connection Pragmas
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        "#,
    )
    .map_err(|e| format!("Failed to set database pragmas: {e}"))?;

    schema::init_schema(&mut conn)?;
    conn.pragma_update(None, "user_version", 1)
        .map_err(|e| format!("Failed to set user_version to 1: {e}"))?;

    Ok(DbState {
        conn: Arc::new(Mutex::new(conn)),
        data_dir: data_dir.to_path_buf(),
        auth_file: auth_file.to_path_buf(),
        user_data_dir: user_data_dir.to_path_buf(),
    })
}

pub fn init_storage(app: &tauri::AppHandle) -> Result<DbState, String> {
    let (data_dir, auth_file, user_data_dir) = crate::fs_bridge::resolve_app_dirs(app);
    let db_path = user_data_dir.join("cairn.db");
    open_and_init_db(&db_path, &data_dir, &auth_file, &user_data_dir)
}

pub fn sanitize_fts5_query(raw: &str) -> Option<String> {
    let mut tokens = Vec::new();
    for word in raw.split_whitespace() {
        let clean: String = word.chars().filter(|c| c.is_alphanumeric()).collect();
        if !clean.is_empty() {
            tokens.push(format!("\"{clean}\"*"));
        }
    }
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

#[tauri::command]
pub async fn lh_runtime_init(
    _state: tauri::State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn initializes_schema_and_sets_user_version_1() {
        let tmp = std::env::temp_dir().join(format!("lh_sql_init_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let db_path = tmp.join("cairn.db");
        let data_dir = tmp.join("data");
        let auth_file = tmp.join("auth.json");
        let state = open_and_init_db(&db_path, &data_dir, &auth_file, &tmp).unwrap();
        let conn = state.conn.lock().unwrap();
        let ver: i32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta_db = fs::metadata(&db_path).unwrap();
            assert_eq!(meta_db.permissions().mode() & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn sanitizes_fts5_queries_safely() {
        assert_eq!(
            sanitize_fts5_query("hello world"),
            Some("\"hello\"* \"world\"*".to_string())
        );
        assert_eq!(
            sanitize_fts5_query("foo\"bar: (baz) -qux"),
            Some("\"foobar\"* \"baz\"* \"qux\"*".to_string())
        );
        assert_eq!(sanitize_fts5_query("   "), None);
    }
}
