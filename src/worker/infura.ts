import {
  INFURA_IPFS_KEY,
  INFURA_IPFS_SECRET,
  INFURA_URL,
} from "../../env.json";

export async function pinToInfura(hash: string) {
  try {
    const url = INFURA_URL + "/api/v0/pin/add?arg=" + hash;
    const authorization =
      "Basic " +
      Buffer.from(INFURA_IPFS_KEY + ":" + INFURA_IPFS_SECRET).toString(
        "base64"
      );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization,
      },
    });
    return await response.json();
  } catch (error: any) {
    console.error("pinToInfura error:", error?.message ?? error);
    return undefined;
  }
}

/*

curl "https://ipfs.infura.io:5001/api/v0/cat?arg=<key>" 

curl "https://ipfs.infura.io:5001/api/v0/pin/ls?arg=<ipfs-path>&type=all&quiet=<value>&stream=<value>" \
    -X POST \
    -u "<API_KEY>:<API_KEY_SECRET>"
*/

export async function getInfuraPin(hash: string) {
  try {
    const url = INFURA_URL + "/api/v0/pin/ls?arg=" + hash;
    const authorization =
      "Basic " +
      Buffer.from(INFURA_IPFS_KEY + ":" + INFURA_IPFS_SECRET).toString(
        "base64"
      );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization,
      },
    });
    return await response.json();
  } catch (error: any) {
    console.error("getInfuraPin error:", error?.message ?? error);
    return undefined;
  }
}

export async function isPinnedToInfura(hash: string): Promise<boolean> {
  try {
    const result = await getInfuraPin(hash);
    return (
      (result && result.Keys && result?.Keys[hash]?.Type === "recursive") ??
      false
    );
  } catch (error: any) {
    console.error("isPinnedToInfura error:", error?.message ?? error);
    return false;
  }
}
