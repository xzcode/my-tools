//! Independent Java JCA interoperability, using only ephemeral test keys.
use base64::{engine::general_purpose::STANDARD, Engine};
use my_tools_crypto::{execute, Request};
use openssl::{
    pkey::PKey,
    symm::{encrypt, Cipher},
    x509::X509,
};
use serde_json::{json, Value};
use std::{fs, path::Path, process::Command};

fn run(tool: &str, action: &str, input: &str, secondary: &str, options: Value) -> Value {
    let req = Request {
        tool_id: tool.into(),
        action: action.into(),
        input: input.into(),
        secondary_input: secondary.into(),
        options: serde_json::from_value(options).unwrap(),
    };
    let result = execute(&req).unwrap_or_else(|e| panic!("{tool}/{action}: {e}"));
    serde_json::from_str(&result.output).unwrap()
}
#[test]
fn java_jca_bidirectional_rsa_and_keystores() {
    // CI requires Java. Local developer machines may opt in using the provided
    // wrapper (e.g. an isolated JRE) instead of a locally installed JDK.
    let wrapper = std::env::var_os("MY_TOOLS_JAVA_INTEROP");
    let required = std::env::var_os("MY_TOOLS_REQUIRE_JAVA_INTEROP").is_some();
    if wrapper.is_none()
        && !Command::new("javac")
            .arg("-version")
            .output()
            .is_ok_and(|r| r.status.success())
    {
        assert!(
            !required,
            "JDK required for Java interoperability validation"
        );
        eprintln!("Java interop skipped: JDK not installed");
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let message = "Java 21 interoperability: 中文 🔑\n";
    fs::write(root.join("message.bin"), message).unwrap();
    let keys = run(
        "keygen",
        "generate",
        "",
        "",
        json!({"algorithm":"RSA","bits":2048}),
    );
    let sk = keys["files"][0]["data"].as_str().unwrap();
    let pk = keys["files"][1]["data"].as_str().unwrap();
    let certificate = run(
        "certificate",
        "self-sign",
        "",
        sk,
        json!({"commonName":"interop.example.test","sanDns":"interop.example.test"}),
    );
    let cert = certificate["files"][0]["data"].as_str().unwrap();
    for (format, ext) in [("JKS", "jks"), ("PKCS12", "p12")] {
        let output = run(
            "keystore",
            "pack",
            cert,
            sk,
            json!({"storeFormat":format,"storePassphrase":"fixture-store","entryPassphrase":"fixture-entry","alias":"interop"}),
        );
        let data = STANDARD
            .decode(output["files"][0]["data"].as_str().unwrap())
            .unwrap();
        fs::write(root.join(format!("rust.{ext}")), data).unwrap();
    }
    let algorithms = [
        ("RSA-SHA1", "SHA1withRSA"),
        ("RSA-SHA256", "SHA256withRSA"),
        ("RSA-SHA512", "SHA512withRSA"),
    ];
    for (alg, java) in algorithms {
        let s = run(
            "signature",
            "sign",
            message,
            sk,
            json!({"signatureAlgorithm":alg}),
        );
        fs::write(
            root.join(format!("rust-{java}.sig")),
            STANDARD.decode(s["signature"].as_str().unwrap()).unwrap(),
        )
        .unwrap();
    }
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/java/MyToolsInterop.java");
    let output = if let Some(wrapper) = wrapper {
        Command::new(wrapper)
            .arg(root)
            .arg(&source)
            .output()
            .unwrap()
    } else {
        let build = Command::new("javac")
            .arg("-encoding")
            .arg("UTF-8")
            .arg("-d")
            .arg(root)
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            build.status.success(),
            "javac: {}",
            String::from_utf8_lossy(&build.stderr)
        );
        Command::new("java")
            .arg("-cp")
            .arg(root)
            .arg("MyToolsInterop")
            .arg(root)
            .output()
            .unwrap()
    };
    assert!(
        output.status.success(),
        "Java fixture failed: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    println!("{}", String::from_utf8_lossy(&output.stdout));
    for (format, ext) in [("JKS", "jks"), ("PKCS12", "p12")] {
        let encoded = STANDARD.encode(fs::read(root.join(format!("java.{ext}"))).unwrap());
        let options = json!({"storeFormat":format,"storePassphrase":"fixture-store","entryPassphrase":"fixture-entry","alias":"java-origin"});
        let inspected = run("keystore", "inspect", &encoded, "", options.clone());
        if format == "JKS" {
            let entries = inspected["entries"].as_array().unwrap();
            assert!(entries
                .iter()
                .any(|e| e["alias"] == "java-origin" && e["privateKey"] == true));
            assert!(entries
                .iter()
                .any(|e| e["alias"] == "trusted" && e["trustedCertificate"] == true));
        }
        let extracted = run("keystore", "extract", &encoded, "", options.clone());
        let key =
            PKey::private_key_from_pem(extracted["files"][0]["data"].as_str().unwrap().as_bytes())
                .unwrap();
        assert!(key.public_eq(&PKey::public_key_from_pem(pk.as_bytes()).unwrap()));
        let leaf =
            X509::from_pem(extracted["files"][2]["data"].as_str().unwrap().as_bytes()).unwrap();
        assert!(key.public_eq(&leaf.public_key().unwrap()));
        for (alg, java) in algorithms {
            let sig =
                STANDARD.encode(fs::read(root.join(format!("java-{format}-{java}.sig"))).unwrap());
            let valid = run(
                "signature",
                "verify",
                message,
                pk,
                json!({"signatureAlgorithm":alg,"signature":sig}),
            );
            assert_eq!(valid["valid"], true, "{format}/{alg}");
            let tampered = run(
                "signature",
                "verify",
                "modified",
                pk,
                json!({"signatureAlgorithm":alg,"signature":sig}),
            );
            assert_eq!(tampered["valid"], false, "{format}/{alg}");
        }
    }
    let java_aes = fs::read_to_string(root.join("java-aes.txt")).unwrap();
    let rust_aes = encrypt(
        Cipher::aes_256_ecb(),
        b"0123456789abcdef0123456789abcdef",
        None,
        message.as_bytes(),
    )
    .unwrap();
    assert_eq!(java_aes, STANDARD.encode(rust_aes));
}
