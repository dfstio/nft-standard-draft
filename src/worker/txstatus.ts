import { checkZkappTransaction, PublicKey, Mina, Encoding } from "o1js";
import {
  fetchMinaAccount,
  NameContractV2,
  NFTContractV2,
  NFTparams,
} from "minanft";
import { algoliaTx, updateStatus } from "./algolia";
import { pinIfNeeded } from "./pin";
import { BLOCKBERRY_API, IPFS_URL, IPFS_TOKEN } from "../../env.json";
import { Cloud } from "zkcloudworker";

export type NFToperation = "mint" | "transfer" | "update" | "sell" | "buy";
export interface NFTtransaction {
  hash: string;
  chain: string;
  contractAddress: string;
  address: string;
  jobId: string;
  sender: string;
  operation: NFToperation;
  price: string;
  name: string;
}

export async function txStatus(params: {
  hash: string;
  time: number;
  chain: string;
}): Promise<string> {
  const { hash, chain, time } = params;

  if (chain === "mainnet") {
    const tx = await getZkAppTxFromBlockberry({ hash });
    if (tx?.txStatus) return tx?.txStatus;
    if (Date.now() - time > 1000 * 60 * 21) {
      console.error(
        "txStatus: Timeout while checking tx with blockberry",
        chain,
        hash
      );
      return "replaced";
    } else {
      return "pending";
    }
  } else {
    try {
      const tx = await checkZkappTransaction(hash);
      if (tx?.success) return "applied";
      if (Date.now() - time > 1000 * 60 * 21) {
        console.error("txStatus: Timeout while checking tx", chain, hash);
        return "replaced";
      } else {
        return "pending";
      }
    } catch (error) {
      console.error("txStatus: error while checking hash", chain, hash, error);
      return "replaced";
    }
  }
}

async function getZkAppTxFromBlockberry(params: {
  hash: string;
}): Promise<any> {
  const { hash } = params;
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-api-key": BLOCKBERRY_API,
    },
  };
  try {
    const response = await fetch(
      `https://api.blockberry.one/mina-mainnet/v1/zkapps/txs/${hash}`,
      options
    );
    if (response.ok) {
      const result = await response.json();
      return result;
    } else {
      console.error(
        "getZkAppTxFromBlockberry error while getting mainnet hash - not ok",
        { hash, text: response.statusText, status: response.status }
      );
      return undefined;
    }
  } catch (err) {
    console.error(
      "getZkAppTxFromBlockberry error while getting mainnet hash - catch",
      hash,
      err
    );
    return undefined;
  }
}

export async function updateTransaction(params: {
  tx: NFTtransaction;
  status: "applied" | "replaced" | "failed";
  cloud: Cloud;
}): Promise<void> {
  const { tx, status, cloud } = params;
  const {
    jobId,
    chain,
    contractAddress,
    address: nftAddress,
    hash,
    name,
    operation,
  } = tx;
  try {
    const zkApp = new NameContractV2(PublicKey.fromBase58(contractAddress));
    const tokenId = zkApp.deriveTokenId();
    const address = PublicKey.fromBase58(nftAddress);

    const nft = new NFTContractV2(address, tokenId);
    await fetchMinaAccount({
      publicKey: address,
      tokenId,
      force: status === "applied",
    });
    if (!Mina.hasAccount(address, tokenId)) {
      console.error("updateTransaction: No account found", address.toBase58());
      if (status === "replaced" && operation === "mint") {
        console.error(
          "Replaced tx in updateTransaction: Updating algolia index",
          status,
          tx
        );

        try {
          await updateStatus({
            name,
            contractAddress,
            chain,
            hash,
            status,
          });
        } catch (error) {
          console.log(
            "Error in Replaced tx in updateTransaction: algolia: updateStatus",
            error
          );
        }
      }
    } else {
      const name = Encoding.stringFromFields([nft.name.get()]);
      const metadataParams = nft.metadataParams.get();
      const owner = nft.owner.get();
      const nftData = nft.data.get();
      const nftParams = NFTparams.unpack(nftData);
      const ipfs = metadataParams.storage.toIpfsHash();
      const metadata = metadataParams.metadata;
      const price = nftParams.price;
      const version = nftParams.version;
      const data = await localLoadFromIPFS(ipfs);
      if (data === undefined) {
        console.error("updateTransaction: No data found for hash", ipfs);
        return;
      }
      await cloud.saveFile(`uri-` + ipfs, data);

      const json = JSON.parse(data.toString());
      const objectID = chain + "." + contractAddress + "." + name;

      const algoliaData = {
        objectID,
        name,
        chain,
        contractAddress,
        owner: owner.toBase58(),
        price: price.toBigInt().toString(),
        status: "applied",
        jobId,
        ipfs,
        version: version.toBigint().toString(),
        hash,
        ...json,
      };

      console.log("Algolia data", algoliaData);
      await algoliaTx({ data: algoliaData, chain });
      await pinIfNeeded({
        hash: ipfs,
        keyvalues: {
          name,
          contractAddress,
          address: json?.address ?? "",
          chain: "mainnet",
          developer: "DFST",
          repo: "mint-worker",
          project: "MinaNFT",
        },
      });
      const imageHash = json?.image?.replace(
        "https://gateway.pinata.cloud/ipfs/",
        ""
      );
      if (imageHash) {
        await pinIfNeeded({
          hash: imageHash,
          keyvalues: {
            name,
            contractAddress,
            address: json?.address ?? "",
            chain: "mainnet",
            developer: "DFST",
            repo: "mint-worker",
            project: "MinaNFT",
          },
        });
        const data = await localLoadFromIPFS(imageHash);
        if (data === undefined) {
          console.error(
            "updateTransaction: No image data found for hash",
            imageHash
          );
          return;
        }
        await cloud.saveFile(`image-` + imageHash, data);
      } else console.error("updateTransaction: No image found in json", json);
    }
  } catch (error) {
    console.error("updateTransaction error", error);
  }
}

async function localLoadFromIPFS(hash: string): Promise<Buffer | undefined> {
  try {
    const url = IPFS_URL + hash + "?pinataGatewayToken=" + IPFS_TOKEN;
    const response = await fetch(url);
    const result = Buffer.from(await response.arrayBuffer());
    return result;
  } catch (error: any) {
    console.error("loadFromIPFS error:", error?.message ?? error);
    return undefined;
  }
}
