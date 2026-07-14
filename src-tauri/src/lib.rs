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
  <title>MediFlow Mobile Scanner</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      display: flex; 
      flex-direction: column; 
      align-items: center; 
      justify-content: center; 
      min-height: 100vh; 
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); 
      color: #f8fafc; 
      margin: 0; 
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      background: rgba(30, 41, 59, 0.7);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      padding: 32px 24px;
      width: 100%;
      max-width: 340px;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }
    .title { 
      margin: 0; 
      color: #60a5fa; 
      font-size: 28px; 
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    .subtitle { 
      margin: 6px 0 0 0; 
      opacity: 0.8; 
      font-size: 13px;
      font-weight: 500;
      color: #94a3b8;
    }
    .btn-group {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
      margin-top: 28px;
    }
    .btn { 
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
      color: white; 
      padding: 16px; 
      border-radius: 14px; 
      font-size: 16px; 
      font-weight: 700; 
      border: none; 
      cursor: pointer; 
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2); 
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); 
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-align: center;
    }
    .btn.secondary {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #e2e8f0;
      box-shadow: none;
    }
    .btn:active { 
      transform: scale(0.97); 
      opacity: 0.9;
    }
    input[type=file] { display: none; }
    #status { 
      margin-top: 24px; 
      font-size: 13px; 
      font-weight: 600; 
      color: #cbd5e1;
      text-align: center; 
      background: rgba(15, 23, 42, 0.6);
      padding: 8px 16px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.04);
    }
    #preview { 
      margin-top: 20px; 
      max-width: 100%; 
      max-height: 200px; 
      border-radius: 12px; 
      display: none; 
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.4); 
      border: 1px solid rgba(255,255,255,0.1);
    }
  </style>
</head>
<body>
  <div class="card">
    <div style="text-align: center;">
      <h1 class="title">MediFlow</h1>
      <p class="subtitle">Mobile Bills Scanner</p>
    </div>
    
    <div class="btn-group">
      <label for="camera" class="btn">
        <span>📸</span> Snap Bill (Camera)
      </label>
      <input type="file" accept="image/*" capture="environment" id="camera" />
      
      <label for="gallery" class="btn secondary">
        <span>📁</span> Upload from Files
      </label>
      <input type="file" accept="image/*" id="gallery" />
    </div>

    <img id="preview" />
    <div id="status">Waiting for photo...</div>
  </div>

  <script>
    const camera = document.getElementById('camera');
    const gallery = document.getElementById('gallery');
    const status = document.getElementById('status');
    const preview = document.getElementById('preview');

    const handleFile = async (file) => {
       if (!file) return;
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
                 setTimeout(() => { 
                   status.innerText = 'Ready for another photo.'; 
                   preview.style.display = 'none'; 
                   camera.value = ''; 
                   gallery.value = ''; 
                 }, 4000);
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
    };

    camera.addEventListener('change', (e) => {
      if (!e.target.files.length) return;
      handleFile(e.target.files[0]);
    });

    gallery.addEventListener('change', (e) => {
      if (!e.target.files.length) return;
      handleFile(e.target.files[0]);
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
