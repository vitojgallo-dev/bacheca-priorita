// Chiave PUBBLICA di riserva dell'amministratore. Con questa l'app avvolge una copia della
// chiave dati di ogni persona, che si può riaprire solo con la chiave privata corrispondente.
// La privata NON è nel repository: sta sul PC dell'amministratore (vedi LEGGIMI, "Cifratura").
// Non cambiarla: le persone già attive resterebbero con la copia avvolta dalla vecchia.
export const chiaveRiserva = {
  "key_ops": [
    "wrapKey"
  ],
  "ext": true,
  "alg": "RSA-OAEP-256",
  "kty": "RSA",
  "n": "i62wV99sdc9msIS43PyKW-Xh1kD6Vi4yK9JWiyi5hAAEM7Z39fusndVZrM5rxmSBCADDwUkSRHgejwZSjGJxw1Yisma2juk9HL3icpCSnT9pzRFuv9tv7bG8Ndyf4NLJPdiRMHNxWDG0GvnO8WKmUZr56FIWbs6cecYAtgicD_2uXZBgVL-oHe8aL0YfoowT7iSvh4NUbKqv07Z3CHUgnUJxTfkZ-yxDv4d5kFnmNVO-Ik7hv7ZfHZDJ_QS9_g2AiHOSeKZnKwu9rUAtqWnHqXaY6k_zkAOI3GsD07kE5Zq0v8H_xMu57S6ajxYFad75rBmPKspDEMi-zFQAcGW4S2JgJGzR03spFOdVmzh1vltDCfa-bgEJcz23X0yMStXEP15zXnO0jmd8sUAOaiHyOyVfjbMnJg4X7Hz6Ep_dKEgCWqKAL-k4PfCHSIPXTf2EEuE1NcCpZweuYjE1Svq567sWXyL6u3Sqt-REiKbGdEmcC4YzFqTOzNXFrTewt5QD",
  "e": "AQAB",
  "kid": "riserva-2026-10-14"
};
