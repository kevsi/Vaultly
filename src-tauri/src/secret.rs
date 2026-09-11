//! Chiffrement au repos des secrets : DPAPI (`CryptProtectData`) sur Windows,
//! lié au profil Windows de l'utilisateur courant ; trousseau système
//! (Keychain macOS / Secret Service Linux) via `keyring` ailleurs.
//!
//! Formats stockés dans `settings` :
//! - `dpapi1:<base64>` — valeur chiffrée (Windows) ;
//! - `key1:<account>` — simple référence : la valeur réelle ne vit QUE dans
//!   le trousseau système ;
//! - pas de préfixe = valeur écrite avant ce mécanisme (ou fallback clair si
//!   le moyen de protection était indisponible à l'écriture) — relue telle
//!   quelle, puis protégée à la première réécriture : pas de migration
//!   bloquante.

/// Préfixe DPAPI (Windows).
const DPAPI_PREFIX: &str = "dpapi1:";
/// Préfixe trousseau système (macOS/Linux).
const KEYRING_PREFIX: &str = "key1:";
/// Nom du service sous lequel les entrées du trousseau sont rangées.
#[cfg(not(windows))]
const KEYRING_SERVICE: &str = "com.kevsi.vaultly";

/// Vrai si la valeur stockée est protégée par ce module. Les DEUX préfixes
/// comptent : une base restaurée depuis l'autre famille d'OS doit être
/// reconnue comme protégée (donc illisible), pas comme un secret en clair.
pub fn is_encrypted(stored: &str) -> bool {
    stored.starts_with(DPAPI_PREFIX) || stored.starts_with(KEYRING_PREFIX)
}

/// Vrai si un secret vit actuellement en clair dans les settings (moyen de
/// protection indisponible lors de sa dernière écriture). Exposé pour que
/// l'UI puisse prévenir l'utilisateur — le downgrade ne doit pas rester
/// invisible.
pub fn plaintext_stored(stored: &str) -> bool {
    !stored.is_empty() && !is_encrypted(stored)
}

/// Protège `plain`. `account` nomme l'entrée de trousseau (ignoré sous
/// Windows : DPAPI ne stocke pas par compte). Une valeur vide reste vide —
/// les backends de trousseau refusent souvent la chaîne vide et un secret
/// vide n'a rien à protéger.
#[cfg(windows)]
pub fn protect(_account: &str, plain: &str) -> String {
    use base64::Engine;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if plain.is_empty() {
        return String::new();
    }
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
            "{DPAPI_PREFIX}{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    } else {
        // DPAPI indisponible : mieux vaut un secret en clair qu'une app
        // incapable de démarrer — mais ça doit rester visible dans les logs.
        tracing::warn!("DPAPI indisponible : secret stocké en clair (CryptProtectData a échoué)");
        plain.to_string()
    }
}

/// Relit une valeur protégée sous Windows. Une référence `key1:` (base
/// restaurée depuis macOS/Linux) est indéchiffrable ici → secret absent.
#[cfg(windows)]
pub fn unprotect(_account: &str, stored: &str) -> String {
    use base64::Engine;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let Some(b64) = stored.strip_prefix(DPAPI_PREFIX) else {
        if stored.starts_with(KEYRING_PREFIX) {
            return String::new();
        }
        // valeur antérieure en clair : acceptée, protégée à la prochaine écriture
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

#[cfg(not(windows))]
pub fn protect(account: &str, plain: &str) -> String {
    if plain.is_empty() {
        return String::new();
    }
    let entry = match keyring::Entry::new(KEYRING_SERVICE, account) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("trousseau indisponible ({e}) : secret {account} stocké en clair");
            return plain.to_string();
        }
    };
    match entry.set_password(plain) {
        // la valeur réelle ne vit QUE dans le trousseau ; settings ne garde
        // que la référence (et l'UI sait qu'elle est protégée)
        Ok(()) => format!("{KEYRING_PREFIX}{account}"),
        Err(e) => {
            tracing::warn!("trousseau indisponible ({e}) : secret {account} stocké en clair");
            plain.to_string()
        }
    }
}

#[cfg(not(windows))]
pub fn unprotect(_account: &str, stored: &str) -> String {
    let Some(acc) = stored.strip_prefix(KEYRING_PREFIX) else {
        // dpapi1: = base restaurée depuis Windows : indéchiffrable ici
        if stored.starts_with(DPAPI_PREFIX) {
            return String::new();
        }
        // valeur antérieure en clair : acceptée, protégée à la prochaine écriture
        return stored.to_string();
    };
    match keyring::Entry::new(KEYRING_SERVICE, acc).map(|e| e.get_password()) {
        Ok(Ok(plain)) => plain,
        // entrée absente (trousseau vidé, autre utilisateur) : secret à
        // considérer comme absent — l'utilisateur régénérera le jeton.
        Ok(Err(e)) => {
            tracing::warn!("entrée {acc} absente du trousseau ({e})");
            String::new()
        }
        Err(e) => {
            tracing::warn!("trousseau indisponible ({e}) : secret {acc} illisible");
            String::new()
        }
    }
}

/// Efface la valeur du trousseau quand la ligne `settings` correspondante est
/// supprimée (sinon l'entrée survivrait à l'effacement de la config).
/// No-op sous Windows (DPAPI : la valeur meurt avec la ligne).
pub fn erase(account: &str, stored: &str) {
    #[cfg(not(windows))]
    if stored.starts_with(KEYRING_PREFIX) {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account) {
            // best effort : `NoEntry` (déjà effacé) n'est pas une erreur
            if let Err(e) = entry.delete_credential() {
                tracing::debug!("entrée de trousseau {account} non effacée : {e}");
            }
        }
    }
    #[cfg(windows)]
    let _ = (account, stored);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let secret = "ya29.test-token-1234";
        let stored = protect("test_roundtrip", secret);
        // sur Windows : chiffré + préfixé. Ailleurs : le trousseau des
        // runners CI n'est pas garanti (fallback en clair assumé) — on ne
        // vérifie que le roundtrip, qui doit passer dans les DEUX cas.
        if cfg!(windows) {
            assert!(stored.starts_with(DPAPI_PREFIX));
            assert_ne!(stored, secret);
        }
        assert_eq!(unprotect("test_roundtrip", &stored), secret);
        erase("test_roundtrip", &stored);
    }

    #[test]
    fn legacy_plaintext_passes_through() {
        assert_eq!(
            unprotect("k", "token-en-clair-ancien"),
            "token-en-clair-ancien"
        );
    }

    #[test]
    fn empty_value_roundtrips_empty() {
        let stored = protect("k", "");
        assert_eq!(unprotect("k", &stored), "");
        assert!(!plaintext_stored(&stored), "vide n'est pas un downgrade");
    }

    #[test]
    fn both_protection_prefixes_count_as_encrypted() {
        assert!(is_encrypted("dpapi1:QUJD"));
        assert!(is_encrypted("key1:mcp_token"));
        assert!(!plaintext_stored("dpapi1:QUJD"));
        assert!(!plaintext_stored("key1:mcp_token"));
    }

    #[cfg(not(windows))]
    #[test]
    fn foreign_prefixes_are_unreadable_not_plaintext() {
        // une base restaurée depuis l'autre famille d'OS : les secrets sont
        // absents (retour vide), jamais révélés ni présentés comme du clair
        assert_eq!(unprotect("k", "dpapi1:QUJD"), "");
    }
}
