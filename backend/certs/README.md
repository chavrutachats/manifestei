# Certificado raiz do App Attest

Baixe o certificado oficial da Apple e salve nesta pasta (ele é público e não é segredo):

```bash
curl -fsSL -o certs/Apple_App_Attestation_Root_CA.pem \
  https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
openssl x509 -in certs/Apple_App_Attestation_Root_CA.pem -noout -subject -enddate
# subject deve ser: CN = Apple App Attestation Root CA, O = Apple Inc., ST = California
```

A API recusa iniciar sem este arquivo (`APPLE_APP_ATTEST_ROOT_CA_PATH`). Ele é a âncora
de confiança: toda atestação iOS precisa encadear até ele.
