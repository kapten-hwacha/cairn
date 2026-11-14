use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PencilDrawerResult {
    pub cancelled: bool,
    pub png_base64: Option<String>,
    pub drawing_data_b64: Option<String>,
    pub height_ratio: f64,
}

#[cfg(target_os = "ios")]
mod ios {
    use super::PencilDrawerResult;
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Emitter};
    use tokio::sync::oneshot;

    static APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

    type HeightCb = extern "C" fn(f64);
    type CompleteCb = extern "C" fn(*const c_char, *mut c_void);
    pub type OpenFn = extern "C" fn(
        *const c_char,
        f64,
        Option<HeightCb>,
        Option<CompleteCb>,
        *mut c_void,
    );
    pub type CloseFn = extern "C" fn();

    static OPEN_FN: OnceLock<OpenFn> = OnceLock::new();
    static CLOSE_FN: OnceLock<CloseFn> = OnceLock::new();

    #[no_mangle]
    pub extern "C" fn lh_pencil_register_callbacks(open_fn: OpenFn, close_fn: CloseFn) {
        let _ = OPEN_FN.set(open_fn);
        let _ = CLOSE_FN.set(close_fn);
    }

    extern "C" fn on_height_changed(height_px: f64) {
        if let Some(lock) = APP_HANDLE.get() {
            if let Ok(guard) = lock.lock() {
                if let Some(app) = guard.as_ref() {
                    let _ = app.emit("lh://pencil-drawer-height", height_px);
                }
            }
        }
    }

    extern "C" fn on_drawer_complete(json_ptr: *const c_char, ctx: *mut c_void) {
        if ctx.is_null() {
            return;
        }
        let tx = unsafe { Box::from_raw(ctx as *mut oneshot::Sender<String>) };
        let payload = if json_ptr.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(json_ptr) }
                .to_string_lossy()
                .into_owned()
        };
        let _ = tx.send(payload);
    }

    pub async fn open_drawer(
        app: AppHandle,
        initial_drawing_b64: Option<String>,
        height_ratio: Option<f64>,
    ) -> Result<PencilDrawerResult, String> {
        let slot = APP_HANDLE.get_or_init(|| Mutex::new(None));
        if let Ok(mut guard) = slot.lock() {
            *guard = Some(app);
        }

        let initial_cstr = match initial_drawing_b64 {
            Some(ref s) if !s.is_empty() => {
                Some(CString::new(s.as_str()).map_err(|e| format!("Invalid drawing data: {e}"))?)
            }
            _ => None,
        };

        let open_fn = OPEN_FN
            .get()
            .ok_or_else(|| "PencilKit bridge not initialized".to_string())?;

        let (tx, rx) = oneshot::channel::<String>();
        let ctx = Box::into_raw(Box::new(tx)) as *mut c_void;
        let ptr = initial_cstr
            .as_ref()
            .map_or(std::ptr::null(), |c| c.as_ptr());
        let ratio = height_ratio.unwrap_or(0.50);

        open_fn(
            ptr,
            ratio,
            Some(on_height_changed),
            Some(on_drawer_complete),
            ctx,
        );

        let json = rx
            .await
            .map_err(|_| "PencilKit drawer closed unexpectedly".to_string())?;
        if json.is_empty() {
            return Err("PencilKit drawer returned an empty payload".to_string());
        }
        serde_json::from_str::<PencilDrawerResult>(&json)
            .map_err(|e| format!("Failed to parse PencilKit payload: {e}"))
    }

    pub fn close_drawer() {
        if let Some(close_fn) = CLOSE_FN.get() {
            close_fn();
        }
    }
}

#[tauri::command]
pub async fn lh_pencil_open_drawer(
    app: AppHandle,
    initial_drawing_b64: Option<String>,
    height_ratio: Option<f64>,
) -> Result<PencilDrawerResult, String> {
    #[cfg(target_os = "ios")]
    {
        ios::open_drawer(app, initial_drawing_b64, height_ratio).await
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, initial_drawing_b64, height_ratio);
        Err("PencilKit is only available on iOS/iPadOS".to_string())
    }
}

#[tauri::command]
pub fn lh_pencil_close_drawer() -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        ios::close_drawer();
    }
    Ok(())
}
