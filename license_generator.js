const crypto = require('crypto');

// SIMPAN FILE INI BAIK-BAIK DI LAPTOP/KOMPUTER ANDA.
// JANGAN SERTAKAN FILE INI SAAT MENDISTRIBUSIKAN SOURCE CODE KE PEMBELI.
// INI ADALAH PRIVATE KEY UNTUK MEMBUAT LISENSI.

const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC4uGgsUiGXUFxr
IoegyIywnMnCOj9dQmiNLdq0kBVl7TslAEckYZeEG37S8d5xohFlHQpv4wYwrSZk
N/BGiHuGNNklCgHHADI3F3xB66868tKto21TeEVDrDPrXbhCS36Mvk2tAAnJ7fUh
TIw6ZsiJbvdk0QF64ojQ3prdZEVVgAWBnhhXlYNLu/OqT33UeYMfcKF6Ycxl98nA
D2VsgP96zRM5prvVtdTfLPAeVeL49Ywt1rrr7G4gkZ1ta06rpkqY8JD8uq7tUzYB
mZ2HGSgQu5V0EBot1PKZKpl0eT0EpYZj35TAdPQciYzr4YiP2juC900WDx7KmI+W
PZLOAgS/AgMBAAECggEALZWsd4uJKJs3Q2URDVeQiKEYlSrkqjISNQzk1Pxdm3qw
xs/Lvqmqx3o1kP8JQweYvVguVDA1PdvtBnxbejyCJztxftd6Ws6slbXg/y+XXbfA
0ALtntSmWy3q3iGRsCKLR1ZLOu8wezmS7bXDQUJOKMROnv2JHPc8hjb5BruQ9Kko
zLpblKbPZ5NEky6dH7mrCvqT0qADc5yf1TvTCpmka39xUCNxXbVvetThWvM4T6ZJ
DMsndwSEoepR/PIM44ZkYM72LvTsYMTcYliGFfz9AodDoWB9mSNMZOSp0/YggsoD
ePTafD1jvKeu5ztyM0WIm1RggeshWG+4SKDDWFThiQKBgQDhZ7bAPGVSMzm0dVKD
bH6+X+2YPS9wrknBDfyTFdNeJKjnS7NGqNjFmSGEUxLuaArKxy5iqfxXApfwZRtw
KO0qSukbxHa8ImE3OZXcPfDmcoAdQvNdVrsIxUgPfrK9j2+IId3e8mNAPUfd+yD3
h7gLBfQGBlukP83X4/SFZzoMQwKBgQDRyv6PaXzFV7fzqiJwsJb8tWtHtlpzl+Tv
7Ppks4T7Pf0X2WzDFRuIfJnYmqx3YLVuzghXt3ejZr3D5qS25dK5FOnLdOdwdn6d
x2IKaC49WhnAZJX0lFpD2/DeUWS7PqgJMjBBfjr8ERhQUSDo7xCbALmUvqGmtiVj
wCKGfZ5b1QKBgDIo2ko9Jm78Z0L5OLt2UV4cCstuEjiJEHCdpC83FCpHDi8qcWKw
AE04nnTL59KV5JDrci8SlMzoDte4KDr1YJGgye8b8TA8llWrwuWYAxvFLy1T0MRc
oJJ7FGYeU7hLSw6IOs96MQwClxOW5uculI4fbQZKM+qBKFV6rNdi+U/xAoGAODpc
4dkW/NlWzzLRSjy6Kv8AwtaoBYU3ceqk7aqDwMbLd8HpeZvFpl4m6bwC73f3CLyl
1cSxhxT5VXESwoZ0ZPCq/MHXafgIVYdjyoBDrGPitQMAge3lB30CYMOV6O2RIe3W
qycG7hoy1wv3cxbn73NRSgGR19nHyaVsW3l9oQUCgYAV99tw2ACpFUU1d3rB0pG3
fGNHQG5POr6Rr3d7CzHCFf8wD8ikAAWQTdxSiEb9mjzrxm7OI+MWKGqWl5vYPT63
ol/bIUIujh5qQbmkjEploqW/RiwIV9f7gCdxiEBsCCu0N1pquzGhBQhwDCx21pgE
2rbGXWGGH3vQUx1UOTk7+w==
-----END PRIVATE KEY-----`;

function generateLicense(clientInfo) {
  const sign = crypto.createSign('SHA256');
  sign.update(clientInfo);
  sign.end();
  const signature = sign.sign(privateKey, 'base64');
  const payload = Buffer.from(clientInfo).toString('base64');
  // Format: base64(info).signature
  return payload + '.' + signature;
}

const clientInfo = process.argv[2];

if (!clientInfo) {
  console.log("Cara penggunaan: node license_generator.js \"NamaPembeli atau Email\"");
  console.log("Contoh: node license_generator.js \"budi@gmail.com\"");
  process.exit(1);
}

const licenseKey = generateLicense(clientInfo);

console.log("\n=======================================================");
console.log("LISENSI BERHASIL DIBUAT");
console.log("=======================================================");
console.log("Informasi Klien :", clientInfo);
console.log("License Key     :\n");
console.log(licenseKey);
console.log("\n=======================================================");
console.log("Berikan teks License Key di atas kepada pembeli.");
