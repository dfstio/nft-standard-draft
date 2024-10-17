import { pinToInfura, isPinnedToInfura } from "./infura";
import { pinToPinata, fetchPin } from "./pinata";

export async function pinIfNeeded(params: {
  hash: string;
  keyvalues: {
    name: string;
    contractAddress: string;
    address: string;
    chain: string;
    developer: string;
    repo: string;
    project: string;
  };
}) {
  const { hash, keyvalues } = params;
  try {
    let pinned = false;
    const pinataPin = await fetchPin(hash);
    if (pinataPin) {
      //console.log("Already pinned to Pinata", hash);
    } else {
      console.log("Pinning to Pinata", hash);
      const result = await pinToPinata(params);
      console.log("Pinata pin result:", { hash, result });
      pinned = true;
    }

    const isPinnedToInfuraResult = await isPinnedToInfura(hash);
    if (isPinnedToInfuraResult) {
      //console.log("Already pinned to Infura", hash);
    } else {
      //console.log("Pinning to Infura", hash);
      const result = await pinToInfura(hash);
      console.log("Infura pin result:", { hash, result });
      pinned = true;
    }
    return pinned;
  } catch (error) {
    console.error("pinIfNeeded error", { hash, error });
    return false;
  }
}
