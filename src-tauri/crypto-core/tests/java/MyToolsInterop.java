import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.Certificate;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.util.Base64;

// Only generated fixtures. Never run against a user's real keys.
public class MyToolsInterop {
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]);
        char[] storePass = "fixture-store".toCharArray();
        char[] entryPass = "fixture-entry".toCharArray();
        byte[] message = Files.readAllBytes(root.resolve("message.bin"));
        for (String format : new String[]{"JKS", "PKCS12"}) {
            String ext = format.equals("JKS") ? "jks" : "p12";
            KeyStore store = KeyStore.getInstance(format);
            try (InputStream in = Files.newInputStream(root.resolve("rust." + ext))) {
                store.load(in, storePass);
            }
            char[] keyPass = format.equals("JKS") ? entryPass : storePass;
            PrivateKey sk = (PrivateKey) store.getKey("interop", keyPass);
            Certificate[] chain = store.getCertificateChain("interop");
            if (sk == null || chain == null || chain.length == 0) throw new AssertionError("Missing key/cert: " + format);
            for (String alg : new String[]{"SHA1withRSA", "SHA256withRSA", "SHA512withRSA"}) {
                Signature s = Signature.getInstance(alg);
                s.initVerify(chain[0]);
                s.update(message);
                if (!s.verify(Files.readAllBytes(root.resolve("rust-" + alg + ".sig")))) {
                    throw new AssertionError("Java verify failed: " + format + "/" + alg);
                }
                s.initSign(sk);
                s.update(message);
                Files.write(root.resolve("java-" + format + "-" + alg + ".sig"), s.sign());
            }
            KeyStore fresh = KeyStore.getInstance(format);
            fresh.load(null, storePass);
            fresh.setKeyEntry("java-origin", sk, keyPass, chain);
            if (format.equals("JKS")) fresh.setCertificateEntry("trusted", chain[0]);
            try (OutputStream out = Files.newOutputStream(root.resolve("java." + ext))) { fresh.store(out, storePass); }
            System.out.println("Java " + format + " load/sign/write OK");
        }
        byte[] key = "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8);
        Cipher c = Cipher.getInstance("AES/ECB/PKCS5Padding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"));
        Files.writeString(root.resolve("java-aes.txt"), Base64.getEncoder().encodeToString(c.doFinal(message)), StandardCharsets.US_ASCII);
        System.out.println("Java AES/ECB/PKCS5Padding fixture OK");
    }
}
