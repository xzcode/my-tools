fn main() {
    println!("cargo:rerun-if-env-changed=MY_TOOLS_UPDATE_ENDPOINT");
    println!("cargo:rerun-if-env-changed=MY_TOOLS_UPDATE_PUBKEY");
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "read_clipboard",
            "write_clipboard",
            "open_text_files",
            "save_text_file",
            "save_batch_files",
            "read_dropped_files",
            "open_binary_file",
            "save_binary_file",
            "load_aes_workspace",
            "save_aes_workspace",
            "clear_aes_workspace",
            "enable_aes_workspace_exit_guard",
            "finish_aes_workspace_exit",
            "load_preferences",
            "save_preferences",
            "show_main_window",
            "show_launcher",
            "hide_current_window",
            "get_desktop_status",
            "check_for_updates",
            "install_update",
        ]));
    tauri_build::try_build(attributes).expect("failed to build My Tools desktop metadata");
}
