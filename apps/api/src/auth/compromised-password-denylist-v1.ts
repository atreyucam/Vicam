import { createHash } from "node:crypto";

export const compromisedPasswordDenylistVersion = "vicam-compromised-passwords-v1";

// SHA-256 of NFKC + lowercase UTF-8 values. Plaintext compromised passwords are not shipped.
const compromisedPasswordHashes = new Set([
  "65c21921ca10a8502757efc9aa552874d181c6206feb2845a921eb57f5e518d4",
  "5751a44782594819e4cb8aa27c2c9d87a420af82bc6a5a05bc7f19c3bb00452b",
  "9c781a9a01bcad170381302ba11629a1af2ca0f8734b1acb43aa88888cf4356a",
  "b793a7ce1c4ea8277f794f055b5020cc83f1dc1614992096c202845dd99abab4",
  "5c06eb3d5a05a19f49476d694ca81a36344660e9d5b98e3d6a6630f31c2422e7",
  "4802e69fa67a98efb30024d025c23dc48aade7e6ae80e39b96124e16aa355f5a",
  "c55a54731575275aa3e097040d54cac73ac3dc02b5593b4eb62fbaa8214820e7",
  "0eef6a1dcee06e8721124d7bf955a9383f782857de66861db8ea4d4b6cbaf80c",
  "b33e34cc50eb9067a0d6759adbacb29f094e1f5adc59671d2df74f36a3b87572",
  "46c54a45fc4d6909121e0bac604cc0a2f430ace4892f851ca7f99df0c2a96a14",
  "cdbbb27208ff1202087b2288f33d61e8a2ec61b824119fd7d1b7e9d58ce3bfa1",
  "ebeaa73c5b83c187376dc93ba8da5c511a3e010ae1bfd551c3a3aebb68482edc",
  "f8d9b9d82206416b66db10ca6fbe449ae486b8616e5dd91658adcea8d433c659",
  "2a77b949887b6093568e27529e2e661e156209094d8e8a62d9f4d1e9e0457646",
  "06f1ac6173b0b9659e251e59a489078f4d60613f223410fb40c325716c9b9709",
  "5d4383513ba0b5318dc9755f3948f32c43a87abe4500ea640445e5916b8b3fac",
  "b86bae2bb62f2441cd9fe1add82147d0748cd70e3e84be4c24fadbd2c4436b4e",
  "6bc019e0ce5d5c265c3bfb0929898c01ffa164bf6453de82722da8028165607e",
  "13b2e8c32ef3688faacdc26ee3091f0eed651b5dbcff8359f4b5cb9c609493e6",
  "e840aaa3dcb935672d3543936eb16e07dee855a48231452d419514627de9d589",
  "e44707e74dca64c6cfcbfca74298085ff7ea749cf8e8ae9e059030c1b20accc3",
  "df052803c03be75f42763b2934bc187ccc8bb3a0e2cb0d0e21870d9f080a485b",
  "3d7f4dade3269517fd63c5f043afd2e3151a506adb0e8eaa6275d526cecd7255",
  "b7aa19d33add937b884a01b4567a7e2038d46f179ec3d317a66c2c5f927cd06c",
  "c48bf74cfd3f2aae498a8d16f682a9189ef602f35df6dac5c6a53e3e1badbf5d",
]);

export function compromisedPasswordFingerprint(password: string): string {
  return createHash("sha256")
    .update(password.normalize("NFKC").toLocaleLowerCase("en-US"), "utf8")
    .digest("hex");
}

export function isCompromisedPassword(password: string): boolean {
  return compromisedPasswordHashes.has(compromisedPasswordFingerprint(password));
}
