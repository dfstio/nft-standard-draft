import axios from "axios";
import { IPFS_URL, IPFS_TOKEN } from "../../env.json";

export async function loadFromIPFS(hash: string): Promise<any | undefined> {
  try {
    const url = IPFS_URL + hash + "?pinataGatewayToken=" + IPFS_TOKEN;
    const result = await axios.get(url);
    return result.data;
  } catch (error: any) {
    console.error("loadFromIPFS error:", error?.message ?? error);
    return undefined;
  }
}
