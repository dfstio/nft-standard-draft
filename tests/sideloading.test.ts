import { describe, expect, it } from "@jest/globals";
import {
  PublicKey,
  Mina,
  DynamicProof,
  VerificationKey,
  ZkProgram,
  Field,
  SmartContract,
  Struct,
  method,
  AccountUpdate,
  state,
  State,
  UInt32,
  DeployArgs,
  Bool,
  Cache,
  Signature,
  verify,
  FeatureFlags,
  Experimental,
  SelfProof,
} from "o1js";
import {
  fetchMinaAccount,
  fee,
  sleep,
  blockchain,
  initBlockchain,
  accountBalanceMina,
  Memory,
  TinyContract,
} from "zkcloudworker";
import {
  serializeIndexedMap,
  deserializeIndexedMap,
} from "../src/utils/indexed-map";
import { TEST_ACCOUNTS } from "../env.json";

const { TestPublicKey } = Mina;
type TestPublicKey = Mina.TestPublicKey;
const { IndexedMerkleMap } = Experimental;
const MerkleMap = IndexedMerkleMap(10);

class NFTImmutableState extends Struct({
  creator: PublicKey, // readonly
  canChangeOwner: Bool, // readonly
  nftAddress: PublicKey, // readonly
  tokenId: Field, // readonly
}) {
  static assertEqual(a: NFTImmutableState, b: NFTImmutableState) {
    a.creator.assertEquals(b.creator);
    a.canChangeOwner.assertEquals(b.canChangeOwner);
    a.nftAddress.assertEquals(b.nftAddress);
    a.tokenId.assertEquals(b.tokenId);
  }
}

class NFTState extends Struct({
  immutableState: NFTImmutableState,
  metadata: Field,
  owner: PublicKey,
  version: UInt32,
}) {
  static assertEqual(a: NFTState, b: NFTState) {
    NFTImmutableState.assertEqual(a.immutableState, b.immutableState);
    a.metadata.assertEquals(b.metadata);
    a.owner.assertEquals(b.owner);
    a.version.assertEquals(b.version);
  }
}

export class PluginSignatureProof extends DynamicProof<NFTState, PublicKey> {
  static publicInputType = NFTState;
  static publicOutputType = PublicKey;
  static maxProofsVerified = 0 as const;
  static featureFlags = FeatureFlags.allMaybe;
}

const nftProgram = ZkProgram({
  name: "nftProgram",
  publicInput: NFTState,
  publicOutput: NFTState,
  methods: {
    updateMetadata: {
      privateInputs: [Field, PublicKey],
      async method(initialState: NFTState, metadata: Field, owner: PublicKey) {
        initialState.owner.assertEquals(owner);
        return new NFTState({
          immutableState: initialState.immutableState,
          metadata,
          owner,
          version: initialState.version.add(1),
        });
      },
    },
    changeOwner: {
      privateInputs: [PluginSignatureProof, VerificationKey],
      async method(
        initialState: NFTState,
        proof: PluginSignatureProof,
        vk: VerificationKey
      ) {
        proof.verify(vk);
        NFTState.assertEqual(initialState, proof.publicInput);
        return new NFTState({
          immutableState: initialState.immutableState,
          metadata: initialState.metadata,
          owner: proof.publicOutput,
          version: initialState.version.add(1),
        });
      },
    },
    merge: {
      privateInputs: [SelfProof, SelfProof],
      async method(
        initialState: NFTState,
        proof1: SelfProof<NFTState, NFTState>,
        proof2: SelfProof<NFTState, NFTState>
      ) {
        proof1.verify();
        proof2.verify();
        NFTState.assertEqual(initialState, proof1.publicInput);
        NFTState.assertEqual(proof1.publicOutput, proof2.publicInput);
        return proof2.publicOutput;
      },
    },
  },
});

export class NativeNFTProof extends ZkProgram.Proof(nftProgram) {}

export class SideLoadedNFTProof extends DynamicProof<NFTState, NFTState> {
  static publicInputType = NFTState;
  static publicOutputType = NFTState;
  static maxProofsVerified = 2 as const;
  static featureFlags = FeatureFlags.allMaybe;
}

interface NFTContractDeployParams extends Exclude<DeployArgs, undefined> {
  metadata: Field;
  owner: PublicKey;
  creator: PublicKey;
  metadataVerificationKeyHash: Field;
  canChangeOwner: Bool;
}

export class NFTContract extends SmartContract {
  @state(Field) metadata = State<Field>();
  @state(PublicKey) owner = State<PublicKey>();
  @state(PublicKey) creator = State<PublicKey>();
  @state(UInt32) version = State<UInt32>();
  @state(Field) metadataVerificationKeyHash = State<Field>();
  @state(Bool) canChangeOwner = State<Bool>();

  async deploy(props: NFTContractDeployParams) {
    await super.deploy(props);
    this.metadata.set(props.metadata);
    this.owner.set(props.owner);
    this.creator.set(props.creator);
    this.metadataVerificationKeyHash.set(props.metadataVerificationKeyHash);
    this.version.set(UInt32.from(1));
    this.canChangeOwner.set(props.canChangeOwner);
  }

  @method async updateMetadata(proof: SideLoadedNFTProof, vk: VerificationKey) {
    this.metadataVerificationKeyHash
      .getAndRequireEquals()
      .assertEquals(vk.hash);
    proof.verify(vk);

    const version = this.version.getAndRequireEquals();
    // recursive proofs can increase the version by more than 1
    proof.publicOutput.version.assertGreaterThan(version);

    NFTState.assertEqual(
      proof.publicInput,
      new NFTState({
        immutableState: new NFTImmutableState({
          creator: this.creator.getAndRequireEquals(),
          canChangeOwner: this.canChangeOwner.getAndRequireEquals(),
          nftAddress: this.address,
          tokenId: this.tokenId,
        }),
        metadata: this.metadata.getAndRequireEquals(),
        owner: this.owner.getAndRequireEquals(),
        version,
      })
    );
    this.metadata.set(proof.publicOutput.metadata);
    this.owner.set(proof.publicOutput.owner);
    this.version.set(proof.publicOutput.version);
  }
}

const pluginProgram = ZkProgram({
  name: "pluginProgram",
  publicInput: NFTState,
  publicOutput: PublicKey,
  methods: {
    proveSignature: {
      privateInputs: [PublicKey, Signature],
      async method(
        initialState: NFTState,
        newOwner: PublicKey,
        signature: Signature
      ) {
        signature
          .verify(initialState.owner, [
            ...NFTState.toFields(initialState),
            ...newOwner.toFields(),
          ])
          .assertTrue();
        return newOwner;
      },
    },
  },
});
const chain = "local" as blockchain;
let tinyContractVk: VerificationKey;
let nftContractVk: VerificationKey;
let nftProgramVk: VerificationKey;
let pluginProgramVk: VerificationKey;
const cache: Cache = Cache.FileSystem("./cache");
let owner = TestPublicKey.random();
const creator = TestPublicKey.random();
const metadata = Field(1);
const zkAppKey = TestPublicKey.random();

const nftContract = new NFTContract(zkAppKey);
const tokenId = Field(1); // we do not have TokenContract yet
const immutableState = new NFTImmutableState({
  creator,
  canChangeOwner: Bool(true),
  nftAddress: nftContract.address,
  tokenId,
});
let sender: Mina.TestPublicKey;
const map = new MerkleMap();
map.insert(Field(100), Field(500));
let offChainState: string = serializeIndexedMap(map);

describe("NFT with Side loading verification key", () => {
  it("should initialize a blockchain", async () => {
    if (chain === "devnet") {
      await initBlockchain("devnet");
      sender = TestPublicKey.fromBase58(TEST_ACCOUNTS[0].privateKey);
    } else {
      const { keys } = await initBlockchain("local", 1);
      sender = TestPublicKey(keys[0].key);
    }
    console.log("chain:", chain);
    console.log("Contract address:", zkAppKey.toBase58());
    console.log("Sender address:", sender.toBase58());
    console.log("Sender's balance:", await accountBalanceMina(sender));
    Memory.info("before compile");
  });

  it("should analyze contracts methods", async () => {
    console.log("Analyzing contracts methods...");
    console.time("methods analyzed");
    const methods = [
      {
        name: "TinyContract",
        result: await TinyContract.analyzeMethods(),
        skip: false,
      },
      {
        name: "NFTContract",
        result: await NFTContract.analyzeMethods(),
        skip: false,
      },
      {
        name: "pluginProgram",
        result: await pluginProgram.analyzeMethods(),
        skip: true,
      },
      {
        name: "nftProgram",
        result: await nftProgram.analyzeMethods(),
        skip: true,
      },
    ];
    console.timeEnd("methods analyzed");
    const maxRows = 2 ** 16;
    for (const contract of methods) {
      // calculate the size of the contract - the sum or rows for each method
      const size = Object.values(contract.result).reduce(
        (acc, method) => acc + method.rows,
        0
      );
      // calculate percentage rounded to 0 decimal places
      const percentage = Math.round(((size * 100) / maxRows) * 100) / 100;

      console.log(
        `method's total size for a ${contract.name} is ${size} rows (${percentage}% of max ${maxRows} rows)`
      );
      if (contract.skip !== true)
        for (const method in contract.result) {
          console.log(method, `rows:`, (contract.result as any)[method].rows);
        }
    }
  });

  it("should compile TinyContract", async () => {
    console.log("compiling...");
    console.time("compiled TinyContract");
    const { verificationKey } = await TinyContract.compile({ cache });
    tinyContractVk = verificationKey;
    console.timeEnd("compiled TinyContract");
    console.log("TinyContract vk hash:", tinyContractVk.hash.toJSON());
  });

  it("should compile nft ZkProgram", async () => {
    console.time("compiled NFTProgram");
    nftProgramVk = (await nftProgram.compile({ cache })).verificationKey;
    console.timeEnd("compiled NFTProgram");
    console.log("NFTProgram vk hash:", nftProgramVk.hash.toJSON());
  });

  it("should compile NFTContract", async () => {
    console.log("compiling...");
    console.time("compiled NFTContract");
    const { verificationKey } = await NFTContract.compile({ cache });
    nftContractVk = verificationKey;
    console.timeEnd("compiled NFTContract");
    console.log("NFTContract vk hash:", nftContractVk.hash.toJSON());
  });

  it("should compile plugin ZkProgram", async () => {
    console.time("compiled plugin ZkProgram");
    pluginProgramVk = (await pluginProgram.compile({ cache })).verificationKey;
    console.timeEnd("compiled plugin ZkProgram");
    console.log("PluginProgram vk hash:", pluginProgramVk.hash.toJSON());
  });

  it("should deploy a SmartContract", async () => {
    Memory.info("before deploy");
    console.time("deployed");
    await fetchMinaAccount({ publicKey: sender, force: true });
    const tx = await Mina.transaction(
      { sender, fee: 100_000_000 },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await nftContract.deploy({
          creator,
          metadata,
          owner,
          metadataVerificationKeyHash: nftProgramVk.hash,
          canChangeOwner: Bool(true),
        });
      }
    );
    await (await tx.sign([sender.key, zkAppKey.key]).send()).wait();
    console.timeEnd("deployed");
  });

  it("should change owner", async () => {
    if (chain !== "local") {
      await sleep(10000);
    }
    Memory.info("before change owner");
    await fetchMinaAccount({ publicKey: zkAppKey, force: true });
    const initialState = new NFTState({
      immutableState,
      metadata: nftContract.metadata.get(),
      owner: nftContract.owner.get(),
      version: nftContract.version.get(),
    });
    let currentState = initialState;
    const recursiveProofsNumber = 5;
    const proofs: NativeNFTProof[] = [];
    for (let i = 0; i < recursiveProofsNumber; i++) {
      const newOwner = TestPublicKey.random();

      console.time("change owner proof generated");
      const signature = Signature.create(owner.key, [
        ...NFTState.toFields(currentState),
        ...newOwner.toFields(),
      ]);
      const pluginProof = await pluginProgram.proveSignature(
        currentState,
        newOwner,
        signature
      );
      const pluginProofSideLoaded = PluginSignatureProof.fromProof(pluginProof);

      const proof = await nftProgram.changeOwner(
        currentState,
        pluginProofSideLoaded,
        pluginProgramVk
      );
      const ok = await verify(proof, nftProgramVk);
      expect(ok).toBe(true);
      if (!ok) {
        console.log("proof is invalid");
        return;
      }
      proofs.push(proof);
      owner = newOwner;
      currentState = proof.publicOutput;
      console.timeEnd("change owner proof generated");
    }
    // merge all proofs into one
    console.time("merged proofs");
    let mergedProof: NativeNFTProof = proofs[0];
    for (let i = 1; i < proofs.length; i++) {
      mergedProof = await nftProgram.merge(
        initialState,
        mergedProof,
        proofs[i]
      );
    }
    console.timeEnd("merged proofs");
    const changeOwnerProof = SideLoadedNFTProof.fromProof(mergedProof);
    console.time("prepared change owner tx");
    await fetchMinaAccount({ publicKey: zkAppKey, force: true });
    await fetchMinaAccount({ publicKey: sender, force: true });
    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: "Update metadata" },
      async () => {
        await nftContract.updateMetadata(changeOwnerProof, nftProgramVk);
        //await nftContract.updateMetadata(mergedProof);
      }
    );
    await tx.prove();
    console.timeEnd("prepared change owner tx");
    const txIncluded = await (await tx.sign([sender.key]).send()).wait();
    console.log("change owner tx:", txIncluded.hash);
    if (chain === "devnet") {
      await sleep(10000);
    }
    await fetchMinaAccount({ publicKey: zkAppKey, force: true });
    const ownerCheck = nftContract.owner.get();
    expect(ownerCheck.toBase58()).toBe(owner.toBase58());
    Memory.info("after change owner");
  });

  it("should update metadata", async () => {
    if (chain !== "local") {
      await sleep(10000);
    }
    console.time("updated metadata");
    await fetchMinaAccount({ publicKey: zkAppKey, force: true });
    const newMetadata = Field(7);
    const nftInputState = new NFTState({
      immutableState,
      metadata: nftContract.metadata.get(),
      owner: nftContract.owner.get(),
      version: nftContract.version.get(),
    });
    const proof = await nftProgram.updateMetadata(
      nftInputState,
      newMetadata,
      nftContract.owner.get()
    );
    const metadataProof = SideLoadedNFTProof.fromProof(proof);
    await fetchMinaAccount({ publicKey: zkAppKey, force: true });
    await fetchMinaAccount({ publicKey: sender, force: true });
    const tx = await Mina.transaction(
      { sender, fee: 100_000_000 },
      async () => {
        await nftContract.updateMetadata(metadataProof, nftProgramVk);
        //await nftContract.updateMetadata(proof);
      }
    );
    await tx.prove();
    await (await tx.sign([sender.key]).send()).wait();
    if (chain !== "local") {
      await sleep(10000);
    }
    await fetchMinaAccount({ publicKey: zkAppKey, force: true });
    const metadata = nftContract.metadata.get();
    expect(metadata.toJSON()).toBe(newMetadata.toJSON());
    console.timeEnd("updated metadata");
    Memory.info("after update metadata");
  });
});
