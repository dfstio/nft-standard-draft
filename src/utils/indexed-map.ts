import { Experimental, Field } from "o1js";
import { bigintToBase64, bigintFromBase64 } from "zkcloudworker";
const { IndexedMerkleMap } = Experimental;
type IndexedMerkleMapBase = Experimental.IndexedMerkleMap;

export interface IndexedMapSerialized {
  height: number;
  root: string;
  length: string;
  nodes: string;
  sortedLeaves: string;
}

export function serializeIndexedMap(
  //map: InstanceType<ReturnType<typeof IndexedMerkleMap>>
  map: IndexedMerkleMapBase
) {
  const serializedMap = JSON.stringify(
    {
      height: map.height,
      root: map.root.toJSON(),
      length: map.length.toJSON(),
      nodes: JSON.stringify(map.data.get().nodes, (_, v) =>
        typeof v === "bigint" ? "n" + bigintToBase64(v) : v
      ),
      sortedLeaves: JSON.stringify(
        map.data
          .get()
          .sortedLeaves.map((v) => [
            bigintToBase64(v.key),
            bigintToBase64(v.nextKey),
            bigintToBase64(v.value),
            bigintToBase64(BigInt(v.index)),
          ])
      ),
    },
    null,
    2
  );
  return serializedMap;
}

export function deserializeIndexedMap(params: {
  serializedIndexedMap: string;
  type?: ReturnType<typeof IndexedMerkleMap>;
}): InstanceType<ReturnType<typeof IndexedMerkleMap>> | undefined {
  try {
    const { serializedIndexedMap, type } = params;
    const json = parseIndexedMapSerialized(serializedIndexedMap);
    return deserializeIndexedMapInternal({
      json,
      type: type ?? IndexedMerkleMap(json.height),
    });
  } catch (error: any) {
    console.error("Error deserializing map:", error?.message ?? error);
    return undefined;
  }
}

export function parseIndexedMapSerialized(
  serializedMap: string
): IndexedMapSerialized {
  const json = JSON.parse(serializedMap);
  if (
    json.height === undefined ||
    json.root === undefined ||
    json.length === undefined ||
    json.nodes === undefined ||
    json.sortedLeaves === undefined
  )
    throw new Error("wrong IndexedMerkleMap json format");
  if (typeof json.height !== "number")
    throw new Error("wrong IndexedMerkleMap height format");
  if (typeof json.root !== "string")
    throw new Error("wrong IndexedMerkleMap root format");
  if (typeof json.length !== "string")
    throw new Error("wrong IndexedMerkleMap length format");
  if (typeof json.nodes !== "string")
    throw new Error("wrong IndexedMerkleMap nodes format");
  if (typeof json.sortedLeaves !== "string")
    throw new Error("wrong IndexedMerkleMap sortedLeaves format");
  return json;
}

function deserializeIndexedMapInternal(params: {
  json: IndexedMapSerialized;
  type: ReturnType<typeof IndexedMerkleMap>;
}): InstanceType<ReturnType<typeof IndexedMerkleMap>> {
  const { json, type } = params;
  const map = new type();
  if (json.height !== map.height) {
    throw new Error("wrong IndexedMap height");
  }
  const nodes = JSON.parse(json.nodes, (_, v) => {
    // Check if the value is a string that represents a BigInt
    if (typeof v === "string" && v[0] === "n") {
      // Remove the first 'n' and convert the string to a BigInt
      return bigintFromBase64(v.slice(1));
    }
    return v;
  });
  const sortedLeaves = JSON.parse(json.sortedLeaves).map((row: any) => {
    return {
      key: bigintFromBase64(row[0]),
      nextKey: bigintFromBase64(row[1]),
      value: bigintFromBase64(row[2]),
      index: Number(bigintFromBase64(row[3])),
    };
  });

  map.root = Field.fromJSON(json.root);
  map.length = Field.fromJSON(json.length);
  map.data.updateAsProver(() => {
    return {
      nodes: nodes.map((row: any) => [...row]),
      sortedLeaves: [...sortedLeaves],
    };
  });
  return map;
}
