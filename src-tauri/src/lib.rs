use tauri::{AppHandle, Emitter, Manager};
use std::thread;
use tiny_http::{Server, Response, Header};
use local_ip_address::local_ip;
use base64::{Engine as _, engine::general_purpose::STANDARD};

#[tauri::command]
fn get_local_ip() -> String {
    if let Ok(ip) = local_ip() {
        ip.to_string()
    } else {
        "127.0.0.1".to_string()
    }
}

fn start_scanner_server(app_handle: AppHandle) {
    thread::spawn(move || {
        let server = match Server::http("0.0.0.0:3030") {
            Ok(s) => s,
            Err(e) => {
                println!("[MediFlow] Failed to start local scanner server: {}", e);
                return;
            }
        };
        
        println!("[MediFlow] Local scanner server listening on port 3030");

        for mut request in server.incoming_requests() {
            let method = request.method().as_str();
            let url = request.url();

            if method == "OPTIONS" {
                let response = Response::empty(200)
                    .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
                    .with_header(Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"POST, GET, OPTIONS"[..]).unwrap());
                let _ = request.respond(response);
            } else if method == "GET" && url == "/" {
                let html = r#"<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>MediFlow Auto-Scanner</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: white; margin: 0; }
    .btn { background: #3b82f6; color: white; padding: 20px 40px; border-radius: 16px; font-size: 20px; font-weight: bold; border: none; cursor: pointer; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); transition: transform 0.1s; display: inline-block; margin-top:20px; text-align:center;}
    .btn:active { transform: scale(0.95); }
    input[type=file] { display: none; }
    #status { margin-top: 30px; font-size: 16px; font-weight: 500; opacity: 0.9; text-align: center; }
    #preview { margin-top: 20px; max-width: 80%; max-height: 250px; border-radius: 8px; display: none; box-shadow: 0 4px 6px rgba(0,0,0,0.5); }
  </style>
</head>
<body>
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="margin: 0; color: #60a5fa; font-size: 28px;">MediFlow</h1>
    <p style="margin: 5px 0 0 0; opacity: 0.7;">Bills Mobile Scanner</p>
  </div>
  <label for="camera" class="btn">📸 Snap Bill</label>
  <input type="file" accept="image/*" capture="environment" id="camera" />
  <img id="preview" />
  <div id="status">Waiting for photo...</div>
  <script>
    const camera = document.getElementById('camera');
    const status = document.getElementById('status');
    const preview = document.getElementById('preview');

    camera.addEventListener('change', async (e) => {
      if (!e.target.files.length) return;
      const file = e.target.files[0];
      
      const img = new Image();
      img.onload = async () => {
         const MAX_WIDTH = 2400;
         let w = img.width, h = img.height;
         if (w > MAX_WIDTH) { h = Math.round((h * MAX_WIDTH) / w); w = MAX_WIDTH; }
         const canvas = document.createElement('canvas');
         canvas.width = w; canvas.height = h;
         const ctx = canvas.getContext('2d');
         ctx.drawImage(img, 0, 0, w, h);
         
         const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
         preview.src = dataUrl;
         preview.style.display = 'block';
         status.innerHTML = '🚀 <span style="color:#fbbf24">Sending securely to Desktop...</span>';
         
         try {
             const response = await fetch('/upload', { method: 'POST', body: dataUrl });
             if (response.ok) {
                status.innerHTML = '✅ <span style="color:#4ade80">Sent! Check your PC screen.</span>';
                setTimeout(() => { status.innerText = 'Ready for another photo.'; preview.style.display = 'none'; camera.value = ''; }, 4000);
             } else {
                throw new Error('Server returned ' + response.status);
             }
         } catch(err) {
             status.innerHTML = '❌ <span style="color:#f87171">Failed to send. Check Wi-Fi.</span>';
         }
      };
      const r = new FileReader();
      r.onload = e => img.src = e.target.result;
      r.readAsDataURL(file);
    });
  </script>
</body>
</html>"#;
                let response = Response::from_string(html)
                    .with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap());
                let _ = request.respond(response);
            } else if method == "POST" && url == "/upload" {
                let mut content = String::new();
                if request.as_reader().read_to_string(&mut content).is_ok() {
                    let _ = app_handle.emit("scanned-image", content);
                    let response = Response::from_string("OK")
                        .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
                    let _ = request.respond(response);
                } else {
                    let response = Response::from_string("Error reading body").with_status_code(500)
                        .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
                    let _ = request.respond(response);
                }
            } else {
                let response = Response::from_string("Not Found").with_status_code(404);
                let _ = request.respond(response);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .invoke_handler(tauri::generate_handler![get_local_ip])
    .setup(|app| {
      let handle = app.handle().clone();
      start_scanner_server(handle);

      let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
      std::fs::create_dir_all(&app_dir).ok();
      let db_path = app_dir.join("mediflow.db");
      if !db_path.exists() {
        let resource_path = app.path().resource_dir().expect("failed to get resource dir").join("mediflow.db");
        if resource_path.exists() {
          std::fs::copy(&resource_path, &db_path).ok();
          println!("[MediFlow] Seeded database from bundled resource");
        }
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
