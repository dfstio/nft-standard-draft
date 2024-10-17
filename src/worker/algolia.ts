import { algoliasearch } from "algoliasearch";
import { ALGOLIA_KEY, ALGOLIA_PROJECT } from "../../env.json";
import { loadFromIPFS } from "./ipfs";

export async function algolia(params: {
  name: string;
  ipfs: string;
  contractAddress: string;
  owner: string;
  price: string;
  chain: string;
  status: string;
  jobId?: string;
  hash?: string;
}): Promise<boolean> {
  try {
    const {
      name,
      contractAddress,
      price,
      chain,
      ipfs,
      status,
      owner,
      hash,
      jobId,
    } = params;
    const client = algoliasearch(ALGOLIA_PROJECT, ALGOLIA_KEY);
    if (chain !== "devnet" && chain !== "mainnet" && chain !== "zeko") {
      console.error("Invalid chain", chain);
      return false;
    }
    const objectID = chain + "." + contractAddress + "." + name;
    if (status === "failed" || status === "created") {
      try {
        const existing = await client.getObject({
          indexName: chain,
          objectID,
        });
        console.log("existing object", existing);
        if (existing !== undefined) {
          console.error(
            "algolia: object already exists, will not update with failed or create status",
            { objectID, status, params }
          );
          return false;
        }
      } catch (error) {
        console.log("algolia: cannot find existing object", {
          objectID,
          error,
        });
      }
    }
    console.log("alWriteToken", params);
    const json = await loadFromIPFS(ipfs);
    if (json === undefined) {
      console.error("loadFromIPFS failed", { ipfs });
      return false;
    }
    if (name !== json?.name)
      console.error("name mismatch", { name, jsonName: json.name });
    const data = {
      objectID,
      chain,
      contractAddress,
      owner,
      price,
      status,
      jobId,
      ipfs,
      hash,
      version: "1",
      ...json,
    };

    const result = await client.saveObject({
      indexName: chain,
      body: data,
    });
    if (result.taskID === undefined) {
      console.error("mint-worker: Algolia write result is", result);
    }

    return true;
  } catch (error) {
    console.error("alWriteToken error:", { error, params });
    return false;
  }
}

export async function algoliaTx(params: {
  data: object;
  chain: string;
}): Promise<boolean> {
  const { data, chain } = params;
  try {
    const client = algoliasearch(ALGOLIA_PROJECT, ALGOLIA_KEY);
    if (chain !== "devnet" && chain !== "mainnet" && chain !== "zeko") {
      console.error("Invalid chain", chain);
      return false;
    }
    const result = await client.saveObject({
      indexName: chain + "-txs",
      body: data as Record<string, unknown>,
    });
    if (result.taskID === undefined) {
      console.error("mint-worker: Algolia write result is", result);
    }

    return true;
  } catch (error) {
    console.error("alWriteToken error:", { error, params });
    return false;
  }
}

export async function updatePrice(params: {
  name: string;
  contractAddress: string;
  price: string;
  chain: string;
  hash: string;
}): Promise<boolean> {
  try {
    const { name, contractAddress, price, chain, hash } = params;
    const client = algoliasearch(ALGOLIA_PROJECT, ALGOLIA_KEY);
    if (chain !== "devnet" && chain !== "mainnet" && chain !== "zeko") {
      console.error("Invalid chain", chain);
      return false;
    }
    const result = await client.saveObject({
      indexName: chain,
      body: {
        objectID: chain + "." + contractAddress + "." + name,
        price,
      },
    });
    if (result.taskID === undefined) {
      console.error(
        "mint-worker: updatePrice: Algolia write result is",
        result
      );
    }
    console.log("updatePrice", params);
    const objectID = chain + "." + contractAddress + "." + name;
    const data = await client.getObject({
      indexName: chain,
      objectID,
    });
    if (data === undefined) {
      console.error("updatePrice: object not found", objectID);
      return false;
    }
    if ((data as any).price !== price) {
      (data as any).price = price;
      (data as any).status = "pending";
      (data as any).hash = hash;
      const result = await client.saveObject({
        indexName: chain,
        body: data,
      });
      if (result.taskID === undefined) {
        console.error(
          "mint-worker: updatePrice: Algolia write result is",
          result
        );
      }
    } else console.log("updatePrice: price is the same", price);

    return true;
  } catch (error) {
    console.error("mint-worker: updatePrice error:", { error, params });
    return false;
  }
}

export async function updateOwner(params: {
  name: string;
  contractAddress: string;
  owner: string;
  chain: string;
  hash: string;
}): Promise<boolean> {
  try {
    const { name, contractAddress, owner, chain, hash } = params;
    const client = algoliasearch(ALGOLIA_PROJECT, ALGOLIA_KEY);
    if (chain !== "devnet" && chain !== "mainnet" && chain !== "zeko") {
      console.error("Invalid chain", chain);
      return false;
    }

    console.log("updateOwner", params);
    const objectID = chain + "." + contractAddress + "." + name;
    const data = await client.getObject({
      indexName: chain,
      objectID,
    });
    if (data === undefined) {
      console.error("updatePrice: object not found", objectID);
      return false;
    }
    (data as any).price = "0";
    (data as any).owner = owner;
    (data as any).status = "pending";
    (data as any).hash = hash;
    const result = await client.saveObject({
      indexName: chain,
      body: data,
    });
    if (result.taskID === undefined) {
      console.error(
        "mint-worker: updateOwner: Algolia write result is",
        result
      );
    }

    return true;
  } catch (error) {
    console.error("mint-worker: updateOwner error:", { error, params });
    return false;
  }
}

export async function updateStatus(params: {
  name: string;
  contractAddress: string;
  status: string;
  chain: string;
  hash: string;
}): Promise<boolean> {
  try {
    const { name, contractAddress, chain, hash, status } = params;
    if (status !== "replaced") {
      console.error("updateStatus: Invalid status", status);
      return false;
    }
    const client = algoliasearch(ALGOLIA_PROJECT, ALGOLIA_KEY);
    if (chain !== "devnet" && chain !== "mainnet" && chain !== "zeko") {
      console.error("Invalid chain", chain);
      return false;
    }

    console.log("updateStatus", params);
    const objectID = chain + "." + contractAddress + "." + name;
    const data = await client.getObject({
      indexName: chain,
      objectID,
    });
    if (data === undefined) {
      console.error("updateStatus: object not found", objectID);
      return false;
    }
    (data as any).status = status;
    (data as any).hash = hash;
    const result = await client.saveObject({
      indexName: chain,
      body: data,
    });
    if (result.taskID === undefined) {
      console.error(
        "mint-worker: updateStatus: Algolia write result is",
        result
      );
    }

    return true;
  } catch (error) {
    console.error("mint-worker: updateStatus error:", { error, params });
    return false;
  }
}

export async function algoliaTransaction(params: {
  name: string;
  jobId: string;
  contractAddress: string;
  chain: string;
  hash?: string;
  status?: string;
  operation: string;
  price: string;
  sender: string;
  newOwner?: string;
}): Promise<boolean> {
  try {
    const { jobId, chain } = params;
    const client = algoliasearch(ALGOLIA_PROJECT, ALGOLIA_KEY);
    if (chain !== "devnet" && chain !== "mainnet" && chain !== "zeko") {
      console.error("Invalid chain", chain);
      return false;
    }
    const result = await client.saveObject({
      indexName: chain + "-txs",
      body: {
        objectID: jobId,
        time: Date.now(),
        ...params,
      },
    });
    if (result.taskID === undefined) {
      console.error(
        "mint-worker: algoliaTransaction: Algolia write result is",
        result
      );
    }

    return true;
  } catch (error) {
    console.error("mint-worker: algoliaTransaction error:", { error, params });
    return false;
  }
}
