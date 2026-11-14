use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthRequestPayload {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
}

pub struct OAuthResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

struct PendingOAuth {
    #[allow(dead_code)]
    port: u16,
    shutdown: Arc<AtomicBool>,
    response_sender: Arc<Mutex<Option<mpsc::Sender<OAuthResponse>>>>,
}

static OAUTH_STATE: Mutex<Option<PendingOAuth>> = Mutex::new(None);

pub fn start_oauth_listener_internal(
    on_request: Option<Box<dyn Fn(OAuthRequestPayload) + Send + 'static>>,
) -> Result<u16, String> {
    let mut lock = OAUTH_STATE.lock().unwrap();
    if lock.is_some() {
        return Err("OAuth listener already running".into());
    }

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let shutdown = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel::<OAuthResponse>();
    let response_sender = Arc::new(Mutex::new(Some(tx)));

    *lock = Some(PendingOAuth {
        port,
        shutdown: shutdown.clone(),
        response_sender: response_sender.clone(),
    });

    thread::spawn(move || {
        while !shutdown.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    handle_connection(&mut stream, &shutdown, &rx, &on_request, port);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(std::time::Duration::from_millis(25));
                }
                Err(_) => {
                    if shutdown.load(Ordering::SeqCst) {
                        break;
                    }
                }
            }
        }
    });

    Ok(port)
}

fn send_empty_response(stream: &mut TcpStream, status_line: &str) {
    let resp = format!("{status_line}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(std::net::Shutdown::Write);
}

fn is_valid_host(headers: &[(String, String)], my_port: u16) -> bool {
    let mut hosts = headers.iter().filter(|(k, _)| k == "host");
    let Some((_, value)) = hosts.next() else {
        return false;
    };
    if hosts.next().is_some() {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    lower == "127.0.0.1"
        || lower == "localhost"
        || lower == format!("127.0.0.1:{my_port}")
        || lower == format!("localhost:{my_port}")
}

fn is_valid_callback_query(url_raw: &str, my_port: u16) -> bool {
    if !url_raw.starts_with('/') || url_raw.starts_with("//") {
        return false;
    }
    let origin = format!("http://127.0.0.1:{my_port}");
    let Ok(url) = url::Url::parse(&format!("{origin}{url_raw}")) else {
        return false;
    };
    if url.origin().ascii_serialization() != origin
        || url.path() != "/auth/callback"
        || url.fragment().is_some()
    {
        return false;
    }
    let mut state: Option<String> = None;
    let mut code: Option<String> = None;
    let mut error: Option<String> = None;
    for (key, value) in url.query_pairs() {
        let target = match key.as_ref() {
            "state" => &mut state,
            "code" => &mut code,
            "error" => &mut error,
            _ => continue,
        };
        if target.replace(value.into_owned()).is_some() {
            return false;
        }
    }
    let has_state = state.as_deref().is_some_and(|s| !s.is_empty());
    let has_code_or_error = code.as_deref().is_some_and(|c| !c.is_empty())
        || error.as_deref().is_some_and(|e| !e.is_empty());
    has_state && has_code_or_error
}

fn handle_connection(
    stream: &mut TcpStream,
    shutdown: &Arc<AtomicBool>,
    rx: &mpsc::Receiver<OAuthResponse>,
    on_request: &Option<Box<dyn Fn(OAuthRequestPayload) + Send + 'static>>,
    my_port: u16,
) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(5)));

    let mut buf = [0u8; 4096];
    let mut total_bytes = Vec::new();

    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                total_bytes.extend_from_slice(&buf[..n]);
                if total_bytes.windows(4).any(|w| w == b"\r\n\r\n") || total_bytes.len() > 16384 {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let req_str = String::from_utf8_lossy(&total_bytes);
    let mut lines = req_str.lines();
    let req_line = match lines.next() {
        Some(l) => l,
        None => return,
    };

    let parts: Vec<&str> = req_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0].to_uppercase();
    let url_raw = parts[1];

    let path_part = url_raw.split('?').next().unwrap_or(url_raw);

    if method != "GET" || path_part != "/auth/callback" {
        send_empty_response(stream, "HTTP/1.1 404 Not Found");
        return;
    }

    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_lowercase(), v.trim().to_string()));
        }
    }

    if !is_valid_host(&headers, my_port) || !is_valid_callback_query(url_raw, my_port) {
        send_empty_response(stream, "HTTP/1.1 400 Bad Request");
        return;
    }

    let payload = OAuthRequestPayload {
        method,
        url: url_raw.to_string(),
        headers,
    };

    if let Some(ref cb) = on_request {
        cb(payload);
    }

    match rx.recv_timeout(std::time::Duration::from_secs(60)) {
        Ok(resp) => {
            let has_header = |name: &str| {
                resp.headers
                    .iter()
                    .any(|(k, _)| k.eq_ignore_ascii_case(name))
            };
            let status_line = format!("HTTP/1.1 {} OK\r\n", resp.status);
            let mut head_str = status_line;
            for (k, v) in &resp.headers {
                head_str.push_str(&format!("{k}: {v}\r\n"));
            }
            for (default_key, default_val) in [
                (
                    "Content-Security-Policy",
                    "default-src 'none'; style-src 'unsafe-inline'",
                ),
                ("X-Content-Type-Options", "nosniff"),
                ("Cache-Control", "no-store"),
            ] {
                if !has_header(default_key) {
                    head_str.push_str(&format!("{default_key}: {default_val}\r\n"));
                }
            }
            head_str.push_str(&format!(
                "Content-Length: {}\r\nConnection: close\r\n\r\n",
                resp.body.len()
            ));
            let _ = stream.write_all(head_str.as_bytes());
            let _ = stream.write_all(resp.body.as_bytes());
            let _ = stream.flush();
            let _ = stream.shutdown(std::net::Shutdown::Write);
        }
        Err(_) => {
            send_empty_response(stream, "HTTP/1.1 504 Gateway Timeout");
        }
    }

    shutdown.store(true, Ordering::SeqCst);
    let mut lock = OAUTH_STATE.lock().unwrap();
    if let Some(ref p) = *lock {
        if p.port == my_port {
            *lock = None;
        }
    }
}

pub fn start_oauth_listener() -> Result<u16, String> {
    start_oauth_listener_internal(None)
}

pub fn close_oauth_listener() {
    let mut lock = OAUTH_STATE.lock().unwrap();
    if let Some(pending) = lock.take() {
        pending.shutdown.store(true, Ordering::SeqCst);
    }
}

pub fn validate_oauth_response(status: u16, headers: &[(String, String)]) -> Result<(), String> {
    if !(100..=599).contains(&status) {
        return Err(format!("Invalid HTTP status code: {status}"));
    }
    for (k, v) in headers {
        if k.is_empty() {
            return Err("Header name cannot be empty".to_string());
        }
        if !k
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(format!("Header name contains invalid characters: '{k}'"));
        }
        if k.contains('\r') || k.contains('\n') || k.contains('\0') {
            return Err(
                "Header name contains invalid control characters (CR, LF, or NULL)".to_string(),
            );
        }
        if v.contains('\r') || v.contains('\n') || v.contains('\0') {
            return Err(format!(
                "Header value for '{k}' contains invalid control characters (CR, LF, or NULL)"
            ));
        }
    }
    Ok(())
}

pub fn respond_oauth(
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
) -> Result<(), String> {
    validate_oauth_response(status, &headers)?;
    let sender_opt = {
        let lock = OAUTH_STATE.lock().unwrap();
        lock.as_ref()
            .and_then(|p| p.response_sender.lock().unwrap().take())
    };
    if let Some(sender) = sender_opt {
        sender
            .send(OAuthResponse {
                status,
                headers,
                body,
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No pending OAuth response channel".into())
    }
}

#[tauri::command]
pub async fn lh_oauth_listen_start(app: tauri::AppHandle) -> Result<u16, String> {
    let app_clone = app.clone();
    start_oauth_listener_internal(Some(Box::new(move |payload| {
        let _ = app_clone.emit("lh://oauth-request", payload);
    })))
}

#[tauri::command]
pub async fn lh_oauth_listen_close() -> Result<(), String> {
    close_oauth_listener();
    Ok(())
}

#[tauri::command]
pub async fn lh_oauth_respond(
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
) -> Result<(), String> {
    validate_oauth_response(status, &headers)?;
    respond_oauth(status, headers, body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::Mutex;

    static TEST_MUTEX: Mutex<()> = Mutex::new(());

    #[test]
    fn test_validate_oauth_response_valid() {
        let headers = vec![
            (
                "Content-Type".to_string(),
                "text/html; charset=utf-8".to_string(),
            ),
            (
                "Location".to_string(),
                "http://localhost:5173/auth/callback".to_string(),
            ),
            ("X-Custom_Header".to_string(), "custom-value".to_string()),
        ];
        assert!(validate_oauth_response(200, &headers).is_ok());
        assert!(validate_oauth_response(302, &headers).is_ok());
        assert!(validate_oauth_response(100, &[]).is_ok());
        assert!(validate_oauth_response(599, &[]).is_ok());
    }

    #[test]
    fn test_validate_oauth_response_invalid_status() {
        assert!(validate_oauth_response(99, &[]).is_err());
        assert!(validate_oauth_response(600, &[]).is_err());
        assert!(validate_oauth_response(0, &[]).is_err());
    }

    #[test]
    fn test_validate_oauth_response_crlf_injection() {
        // CRLF in header value
        let crlf_val = vec![(
            "Content-Type".to_string(),
            "text/html\r\nInjected: true".to_string(),
        )];
        assert!(validate_oauth_response(200, &crlf_val).is_err());

        let lf_val = vec![(
            "Content-Type".to_string(),
            "text/html\nInjected: true".to_string(),
        )];
        assert!(validate_oauth_response(200, &lf_val).is_err());

        let null_val = vec![("Content-Type".to_string(), "text/html\0bad".to_string())];
        assert!(validate_oauth_response(200, &null_val).is_err());

        // CRLF or invalid chars in header name
        let crlf_key = vec![("Content-Type\r\n".to_string(), "text/html".to_string())];
        assert!(validate_oauth_response(200, &crlf_key).is_err());

        let space_key = vec![("Content Type".to_string(), "text/html".to_string())];
        assert!(validate_oauth_response(200, &space_key).is_err());

        let colon_key = vec![("Header:Name".to_string(), "val".to_string())];
        assert!(validate_oauth_response(200, &colon_key).is_err());

        let empty_key = vec![("".to_string(), "val".to_string())];
        assert!(validate_oauth_response(200, &empty_key).is_err());
    }

    #[test]
    fn second_start_fails_while_pending() {
        let _guard = TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        close_oauth_listener();
        let port = start_oauth_listener().expect("first listen succeeds");
        assert!(port > 0);
        let second = start_oauth_listener();
        assert!(second.is_err(), "second listen while pending must fail");
        close_oauth_listener();
    }

    #[test]
    fn unsolicited_path_gets_404_without_consuming() {
        let _guard = TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        close_oauth_listener();
        let port = start_oauth_listener().expect("listen succeeds");
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect succeeds");
        stream
            .write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .expect("write succeeds");
        let mut resp = String::new();
        let _ = stream.read_to_string(&mut resp);
        assert!(
            resp.starts_with("HTTP/1.1 404"),
            "expected 404 response, got: {resp}"
        );
        assert!(start_oauth_listener().is_err());
        close_oauth_listener();
    }

    #[test]
    fn consecutive_sign_in_attempts_succeed_after_close() {
        let _guard = TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        close_oauth_listener();
        let port1 = start_oauth_listener().expect("first attempt succeeds");
        close_oauth_listener();
        let port2 = start_oauth_listener().expect("second attempt succeeds after close");
        assert_ne!(port1, 0);
        assert_ne!(port2, 0);
        close_oauth_listener();
    }

    fn send_raw_request(port: u16, req: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect succeeds");
        stream.write_all(req.as_bytes()).expect("write succeeds");
        let mut resp = String::new();
        let _ = stream.read_to_string(&mut resp);
        resp
    }

    #[test]
    fn forged_host_returns_400_without_consuming_listener() {
        let _guard = TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        close_oauth_listener();
        let callback_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let cb_count = callback_count.clone();
        let port = start_oauth_listener_internal(Some(Box::new(move |_| {
            cb_count.fetch_add(1, Ordering::SeqCst);
            respond_oauth(200, vec![], "done".to_string()).expect("respond succeeds");
        })))
        .expect("listen succeeds");

        for req in [
            "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\nHost: evil.com\r\n\r\n".to_string(),
            "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\n\r\n".to_string(),
            format!(
                "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
                port.saturating_add(1)
            ),
            format!(
                "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nHost: localhost:{port}\r\n\r\n"
            ),
        ] {
            let resp = send_raw_request(port, &req);
            assert!(
                resp.starts_with("HTTP/1.1 400 Bad Request"),
                "expected 400 response, got: {resp}"
            );
            assert_eq!(callback_count.load(Ordering::SeqCst), 0);
            assert!(
                start_oauth_listener().is_err(),
                "listener must remain active after 400"
            );
        }

        // Subsequent valid request with case-insensitive localhost:<port> still succeeds.
        let valid_resp = send_raw_request(
            port,
            &format!(
                "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\nHost: LocalHost:{port}\r\n\r\n"
            ),
        );
        assert!(
            valid_resp.starts_with("HTTP/1.1 200"),
            "expected 200 after rejected Host attempts, got: {valid_resp}"
        );
        assert_eq!(callback_count.load(Ordering::SeqCst), 1);
        close_oauth_listener();
    }

    #[test]
    fn invalid_callback_query_returns_400_without_consuming_listener() {
        let _guard = TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        close_oauth_listener();
        let callback_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let cb_count = callback_count.clone();
        let port = start_oauth_listener_internal(Some(Box::new(move |_| {
            cb_count.fetch_add(1, Ordering::SeqCst);
            respond_oauth(200, vec![], "done".to_string()).expect("respond succeeds");
        })))
        .expect("listen succeeds");

        for target in [
            "/auth/callback",
            "/auth/callback?code=abc",
            "/auth/callback?code=abc&state=",
            "/auth/callback?state=xyz",
            "/auth/callback?state=xyz&code=",
            "/auth/callback?state=xyz&error=",
            "/auth/callback?code=abc&state=xyz&state=dup",
            "/auth/callback?code=abc&code=dup&state=xyz",
            "/auth/callback?error=access_denied&error=dup&state=xyz",
            "/auth/callback?code=abc&state=xyz#frag",
        ] {
            let resp = send_raw_request(
                port,
                &format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"),
            );
            assert!(
                resp.starts_with("HTTP/1.1 400 Bad Request"),
                "expected 400 for {target}, got: {resp}"
            );
            assert_eq!(callback_count.load(Ordering::SeqCst), 0);
            assert!(
                start_oauth_listener().is_err(),
                "listener must remain active after invalid query {target}"
            );
        }

        // Valid error callback also succeeds.
        let valid_resp = send_raw_request(
            port,
            &format!(
                "GET /auth/callback?error=access_denied&state=xyz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"
            ),
        );
        assert!(
            valid_resp.starts_with("HTTP/1.1 200"),
            "expected 200 for valid error callback, got: {valid_resp}"
        );
        assert_eq!(callback_count.load(Ordering::SeqCst), 1);
        close_oauth_listener();
    }

    #[test]
    fn respond_oauth_includes_default_security_headers() {
        let _guard = TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        close_oauth_listener();
        let port = start_oauth_listener_internal(Some(Box::new(|_| {
            respond_oauth(
                200,
                vec![("Content-Type".to_string(), "text/html".to_string())],
                "<html>ok</html>".to_string(),
            )
            .expect("respond succeeds");
        })))
        .expect("listen succeeds");

        let resp = send_raw_request(
            port,
            &format!(
                "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"
            ),
        );
        assert!(resp.starts_with("HTTP/1.1 200"), "got: {resp}");
        assert!(
            resp.contains(
                "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n"
            ),
            "missing default CSP header in: {resp}"
        );
        assert!(
            resp.contains("X-Content-Type-Options: nosniff\r\n"),
            "missing X-Content-Type-Options header in: {resp}"
        );
        assert!(
            resp.contains("Cache-Control: no-store\r\n"),
            "missing Cache-Control header in: {resp}"
        );
        close_oauth_listener();

        // Custom headers already provided by respond_oauth are preserved without duplication.
        let port2 = start_oauth_listener_internal(Some(Box::new(|_| {
            respond_oauth(
                200,
                vec![(
                    "content-security-policy".to_string(),
                    "default-src 'self'".to_string(),
                )],
                "ok".to_string(),
            )
            .expect("respond succeeds");
        })))
        .expect("listen succeeds");

        let resp2 = send_raw_request(
            port2,
            &format!(
                "GET /auth/callback?code=abc&state=xyz HTTP/1.1\r\nHost: localhost:{port2}\r\n\r\n"
            ),
        );
        assert!(resp2.starts_with("HTTP/1.1 200"), "got: {resp2}");
        assert!(
            resp2.contains("content-security-policy: default-src 'self'\r\n"),
            "missing caller CSP header in: {resp2}"
        );
        assert!(
            !resp2.contains("Content-Security-Policy:"),
            "must not duplicate CSP header in: {resp2}"
        );
        assert!(
            resp2.contains("X-Content-Type-Options: nosniff\r\n"),
            "missing X-Content-Type-Options header in: {resp2}"
        );
        close_oauth_listener();
    }
}
