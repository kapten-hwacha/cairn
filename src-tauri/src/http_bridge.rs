use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body_base64: Option<String>,
    #[serde(default)]
    pub redirect: Option<String>,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body_base64: String,
}

pub const DEFAULT_MAX_HTTP_BYTES: usize = 55 * 1024 * 1024;

pub fn validate_fetch_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("Invalid URL: {e}"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http and https schemes are allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs with user credentials are not allowed".into());
    }
    let host = url
        .host()
        .ok_or_else(|| "URL must have a host".to_string())?;
    match host {
        url::Host::Domain(domain) => {
            let d = domain.trim_end_matches('.').to_ascii_lowercase();
            if d == "metadata.google.internal"
                || d == "0.0.0.0"
                || d.ends_with_or_eq("nip.io")
                || d.ends_with_or_eq("sslip.io")
                || d.ends_with_or_eq("xip.io")
            {
                return Err("Access to host is forbidden".into());
            }
        }
        url::Host::Ipv4(ip) => {
            if ip.is_unspecified() {
                return Err("Unspecified IP address (0.0.0.0) is forbidden".into());
            }
            if ip.is_link_local() {
                return Err("Link-local address (169.254.0.0/16) is forbidden".into());
            }
        }
        url::Host::Ipv6(ip) => {
            if ip.is_unspecified() {
                return Err("Unspecified IPv6 address (::) is forbidden".into());
            }
            let seg = ip.segments();
            // fe80::/10 unicast link-local
            if (seg[0] & 0xffc0) == 0xfe80 {
                return Err("IPv6 link-local address is forbidden".into());
            }
            // AWS EC2 IPv6 metadata (fd00:ec2::254) or NAT64 (64:ff9b::/96)
            if (seg[0] == 0xfd00 && seg[1] == 0x0ec2 && seg[7] == 0x0254)
                || (seg[0] == 0x0064 && seg[1] == 0xff9b)
            {
                return Err("Metadata or NAT64 IPv6 address is forbidden".into());
            }
            // IPv4-mapped link-local or unspecified: ::ffff:a.b.c.d
            if seg[0] == 0
                && seg[1] == 0
                && seg[2] == 0
                && seg[3] == 0
                && seg[4] == 0
                && seg[5] == 0xffff
            {
                let oct = ip.octets();
                let ipv4 = std::net::Ipv4Addr::new(oct[12], oct[13], oct[14], oct[15]);
                if ipv4.is_unspecified() {
                    return Err("IPv4-mapped unspecified address is forbidden".into());
                }
                if ipv4.is_link_local() {
                    return Err("IPv4-mapped link-local address is forbidden".into());
                }
            }
        }
    }
    Ok(url)
}

trait DomainSuffixCheck {
    fn ends_with_or_eq(&self, suffix: &str) -> bool;
}

impl DomainSuffixCheck for str {
    fn ends_with_or_eq(&self, suffix: &str) -> bool {
        self == suffix || self.ends_with(&format!(".{suffix}"))
    }
}

pub fn validate_external_url(url_str: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url_str).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" {
        return Err("Only https URLs are allowed".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("URLs with user credentials are not allowed".into());
    }
    if parsed.host_str().is_none() {
        return Err("URL must have a host".into());
    }
    Ok(())
}

static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
static NO_REDIRECT_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn get_client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.error("Too many redirects (max 10)");
            }
            if let Err(e) = validate_fetch_url(attempt.url().as_str()) {
                return attempt.error(e);
            }
            attempt.follow()
        });
        reqwest::Client::builder()
            .redirect(policy)
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("Failed to build reqwest client")
    })
}

fn get_no_redirect_client() -> &'static reqwest::Client {
    NO_REDIRECT_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("Failed to build no-redirect reqwest client")
    })
}

#[tauri::command]
pub async fn lh_http_fetch(req: HttpRequest) -> Result<HttpResponse, String> {
    validate_fetch_url(&req.url)?;
    let max_bytes = req.max_bytes.unwrap_or(DEFAULT_MAX_HTTP_BYTES);
    let redirect_mode = req.redirect.as_deref().unwrap_or("follow");
    let client = if matches!(redirect_mode, "manual" | "error") {
        get_no_redirect_client()
    } else {
        get_client()
    };
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| format!("Invalid HTTP method: {e}"))?;
    let mut builder = client.request(method, &req.url);
    for (k, v) in req.headers {
        builder = builder.header(k, v);
    }
    if let Some(body_base64) = req.body_base64 {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(body_base64.as_bytes())
            .map_err(|e| format!("Invalid base64 body: {e}"))?;
        builder = builder.body(bytes);
    }

    let mut response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    if redirect_mode == "error" && (300..400).contains(&status) {
        return Err(format!("Redirect forbidden (HTTP {status})"));
    }
    if let Some(content_len) = response.content_length() {
        if content_len > max_bytes as u64 {
            return Err(format!(
                "Response too large ({content_len} bytes, max {max_bytes})"
            ));
        }
    }
    let mut headers = Vec::new();
    for (name, value) in response.headers() {
        if let Ok(v_str) = value.to_str() {
            headers.push((name.as_str().to_string(), v_str.to_string()));
        }
    }
    let mut body_bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body_bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err(format!("Response too large (> {max_bytes} bytes)"));
        }
        body_bytes.extend_from_slice(&chunk);
    }
    let body_base64 = base64::engine::general_purpose::STANDARD.encode(&body_bytes);

    Ok(HttpResponse {
        status,
        headers,
        body_base64,
    })
}

#[tauri::command]
pub async fn lh_open_external(url: String) -> Result<(), String> {
    validate_external_url(&url)?;
    open::that_detached(&url).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_https_only() {
        assert!(validate_external_url("https://a.com/x").is_ok());
        assert!(validate_external_url("http://a.com").is_err());
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("https://u:p@a.com").is_err());
    }

    #[test]
    fn test_validate_fetch_url() {
        // Blocked cases
        assert!(validate_fetch_url("file:///etc/passwd").is_err());
        assert!(validate_fetch_url("http://169.254.169.254/latest/meta-data/").is_err());
        assert!(validate_fetch_url("http://metadata.google.internal").is_err());
        assert!(validate_fetch_url("http://metadata.google.internal.").is_err());
        assert!(validate_fetch_url("http://0.0.0.0:8080").is_err());
        assert!(validate_fetch_url("http://[fe80::1]:8080").is_err());
        assert!(validate_fetch_url("http://[::]:8080").is_err());
        assert!(validate_fetch_url("http://[::ffff:169.254.1.1]:8080").is_err());
        assert!(validate_fetch_url("http://user:pass@127.0.0.1:8080").is_err());
        assert!(validate_fetch_url("http://169.254.169.254.nip.io/latest/meta-data/").is_err());
        assert!(validate_fetch_url("http://127.0.0.1.sslip.io/").is_err());
        assert!(validate_fetch_url("http://[fd00:ec2::254]/latest/meta-data/").is_err());
        assert!(validate_fetch_url("http://[64:ff9b::169.254.169.254]/").is_err());

        // Allowed cases
        assert!(validate_fetch_url("https://api.openai.com/v1/models").is_ok());
        assert!(validate_fetch_url("http://127.0.0.1:11434/api/tags").is_ok());
        assert!(validate_fetch_url("http://localhost:3000/api").is_ok());
        assert!(validate_fetch_url("http://192.168.1.100:8000/").is_ok());
        assert!(validate_fetch_url("http://[::1]:8080/test").is_ok());
    }
}
