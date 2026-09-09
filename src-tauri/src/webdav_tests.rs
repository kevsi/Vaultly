//! Tests du module webdav — inclus via #[path] pour tenir sous 500 lignes.
use super::*;


    #[test]
    fn normalize_base_validates_and_trails_slash() {
        assert_eq!(
            normalize_base("https://app.koofr.net/dav/Koofr").unwrap(),
            "https://app.koofr.net/dav/Koofr/"
        );
        assert_eq!(
            normalize_base("http://192.168.1.10/dav/").unwrap(),
            "http://192.168.1.10/dav/"
        );
        assert!(normalize_base("ftp://host/dav").is_err());
        assert!(normalize_base("javascript:alert(1)").is_err());
        assert!(normalize_base("https://host/dav?next=evil").is_err());
        assert!(normalize_base("https://host/dav#frag").is_err());
        assert!(normalize_base("https://host/dav a").is_err());
        assert!(normalize_base("").is_err());
    }

    #[test]
    fn backup_name_validation_blocks_traversal() {
        assert!(valid_backup_name("vaultly-backup-20260909-120000.json"));
        assert!(!valid_backup_name("vaultly-backup-../../etc/passwd.json"));
        assert!(!valid_backup_name("../../evil.json"));
        assert!(!valid_backup_name("autre-backup-1.json"));
        assert!(!valid_backup_name("vaultly-backup-.json"));
        assert!(!valid_backup_name("vaultly-backup-1.txt"));
        assert!(!valid_backup_name("vaultly-backup-a/b.json"));
    }

    #[test]
    fn hrefs_extract_ignores_namespaces_and_others() {
        // Nextcloud (préfixe d:) + Koofr (URL absolue) + dossier + fichier
        // étranger + href %encodé : seul notre backup ASCII ressort.
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/files/alex/Vaultly/</d:href><d:propstat/></d:response>
  <d:response><d:href>/remote.php/dav/files/alex/Vaultly/vaultly-backup-20260909-120000.json</d:href></d:response>
  <d:response><d:href>/remote.php/dav/files/alex/Vaultly/note.json</d:href></d:response>
  <d:response><S:href>https://app.koofr.net/dav/Koofr/vaultly-backup-20260910-080000.json</S:href></d:response>
  <d:response><d:href>/remote.php/dav/files/alex/Vaultly/vaultly-backup%2D2099.json</d:href></d:response>
</d:multistatus>"#;
        assert_eq!(
            extract_backup_names(xml),
            vec![
                "vaultly-backup-20260909-120000.json",
                "vaultly-backup-20260910-080000.json"
            ]
        );
    }

    #[test]
    fn sort_order_is_most_recent_first() {
        let mut names = vec![
            "vaultly-backup-20260101-000000.json".to_string(),
            "vaultly-backup-20260910-080000.json".to_string(),
            "vaultly-backup-20251231-235959.json".to_string(),
        ];
        names.sort();
        names.reverse();
        assert_eq!(
            names,
            vec![
                "vaultly-backup-20260910-080000.json",
                "vaultly-backup-20260101-000000.json",
                "vaultly-backup-20251231-235959.json",
            ]
        );
    }

    #[test]
    fn describe_status_maps_common_codes() {
        assert!(describe_status(reqwest::StatusCode::UNAUTHORIZED, "").contains("identifiants"));
        assert!(describe_status(reqwest::StatusCode::NOT_FOUND, "").contains("dossier introuvable"));
        assert!(describe_status(
            reqwest::StatusCode::from_u16(429).unwrap(),
            "<html>Too Many Requests</html>"
        )
        .contains("débit"));
    }
