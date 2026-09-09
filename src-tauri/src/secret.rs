//! Chiffrement au repos des secrets via DPAPI (`CryptProtectData`), lié au
//! profil Windows de l'utilisateur courant : une base SQLite copiée sur une
//! autre machine ou un autre compte ne livre plus les jetons.
//!
//! Format stocké : `dpapi1:<base64>`. Les valeurs sans préfixe (écrites avant
//! ce mécanisme) sont relues telles quelles, puis chiffrées à la première
//! réécriture — pas de migration bloquante.

const PREFIX: &str = "dpapi1:";

/// Vrai si la valeur stockée est déjà chiffrée par ce module.
pub fn is_encrypted(stored: &str) -> bool {
    stored.starts_with(PREFIX)
}

/// Vrai si un secret vit actuellement en clair dans les settings (DPAPI
/// indisponible lors de sa dernière écriture). Exposé pour que l'UI puisse
/// prévenir l'utilisateur — le downgrade ne doit pas rester invisible.
pub fn plaintext_stored(stored: &str) -> bool {
    !stored.is_empty() && !is_encrypted(stored)
}

#[cfg(windows)]
pub fn protect(plain: &str) -> String {
    use base64::Engine;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &in_blob,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };
    if ok != 0 {
        let bytes = unsafe {
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize)
        }
        .to_vec();
        unsafe { LocalFree(out_blob.pbData as *mut _) };
        format!(
            "{PREFIX}{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    } else {
        // DPAPI indisponible : mieux vaut un secret en clair qu'une app
        // incapable de démarrer — mais ça doit rester visible dans les logs.
        tracing::warn!("DPAPI indisponible : secret stocké en clair (CryptProtectData a échoué)");
        plain.to_string()
    }
}

#[cfg(windows)]
pub fn unprotect(stored: &str) -> String {
    use base64::Engine;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let Some(b64) = stored.strip_prefix(PREFIX) else {
        // valeur antérieure en clair : acceptée, chiffrée à la prochaine écriture
        return stored.to_string();
    };
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else {
        return String::new();
    };
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &in_blob,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };
    if ok == 0 {
        // indéchiffrable par CETTE machine / CET utilisateur (base restaurée
        // d'une sauvegarde sur un autre poste) : le secret est à considérer
        // comme absent — l'utilisateur devra se reconnecter.
        return String::new();
    }
    let plain = unsafe {
        String::from_utf8_lossy(std::slice::from_raw_parts(
            out_blob.pbData,
            out_blob.cbData as usize,
        ))
        .to_string()
    };
    unsafe { LocalFree(out_blob.pbData as *mut _) };
    plain
}

// Plateforme non-Windows (hors cible de distribution, garde la compilation) :
// passe-plat sans chiffrement.
#[cfg(not(windows))]
pub fn protect(plain: &str) -> String {
    plain.to_string()
}

#[cfg(not(windows))]
pub fn unprotect(stored: &str) -> String {
    stored.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let secret = "ya29.test-token-1234";
        let stored = protect(secret);
        // sur Windows : chiffré + préfixé ; ailleurs : passe-plat
        if cfg!(windows) {
            assert!(stored.starts_with(PREFIX));
            assert_ne!(stored, secret);
        }
        assert_eq!(unprotect(&stored), secret);
    }

    #[test]
    fn legacy_plaintext_passes_through() {
        assert_eq!(unprotect("token-en-clair-ancien"), "token-en-clair-ancien");
    }
}
