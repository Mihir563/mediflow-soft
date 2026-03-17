use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .setup(|app| {
      // Copy bundled seed DB on first launch
      let app_dir = app.path().app_data_dir().expect("failed to get app data dir");
      std::fs::create_dir_all(&app_dir).ok();
      let db_path = app_dir.join("mediflow.db");
      if !db_path.exists() {
        // Try to copy bundled DB from resources
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
