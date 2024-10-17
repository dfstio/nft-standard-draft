import { Mina, checkZkappTransaction } from "o1js";
import { blockchain, sleep } from "zkcloudworker";

let chain: blockchain = "local" as blockchain;

export function processArguments(): {
  chain: blockchain;
  compile: boolean;
  deploy: boolean;
  transfer: boolean;
  mint: boolean;
  useLocalCloudWorker: boolean;
  useRandomTokenAddress: boolean;
} {
  function getArgument(arg: string): string | undefined {
    const argument = process.argv.find((a) => a.startsWith("--" + arg));
    return argument?.split("=")[1];
  }

  const chainName = getArgument("chain") ?? "local";
  const shouldDeploy = getArgument("deploy") ?? "true";
  const shouldMint = getArgument("mint") ?? "true";
  const shouldTransfer = getArgument("transfer") ?? "true";
  const shouldCompile = getArgument("compile") ?? "true";
  const cloud = getArgument("cloud") ?? "local";
  const random = getArgument("random") ?? "true";
  if (
    chainName !== "local" &&
    chainName !== "devnet" &&
    chainName !== "lightnet" &&
    chainName !== "zeko"
  )
    throw new Error("Invalid chain name");
  chain = chainName as blockchain;

  return {
    chain,
    compile: shouldCompile === "true",
    deploy: shouldDeploy === "true",
    transfer: shouldTransfer === "true",
    mint: shouldMint === "true",
    useLocalCloudWorker: cloud
      ? cloud === "local"
      : chainName === "local" || chainName === "lightnet",
    useRandomTokenAddress: random === "true",
  };
}

export async function sendTx(
  tx: Mina.Transaction<false, true> | Mina.Transaction<true, true>,
  description?: string,
  wait?: boolean
) {
  try {
    let txSent;
    let sent = false;
    while (!sent) {
      txSent = await tx.safeSend();
      if (txSent.status == "pending") {
        sent = true;
        console.log(
          `${description ?? ""} tx sent: hash: ${txSent.hash} status: ${
            txSent.status
          }`
        );
      } else if (chain === "zeko") {
        console.log("Retrying Zeko tx");
        await sleep(10000);
      } else {
        console.log(
          `${description ?? ""} tx NOT sent: hash: ${txSent?.hash} status: ${
            txSent?.status
          }`,
          txSent.errors
        );
        return undefined;
      }
    }
    if (txSent === undefined) throw new Error("txSent is undefined");
    if (txSent.errors.length > 0) {
      console.error(
        `${description ?? ""} tx error: hash: ${txSent.hash} status: ${
          txSent.status
        }  errors: ${txSent.errors}`
      );
    }

    if (txSent.status === "pending" && wait !== false) {
      console.log(`Waiting for tx inclusion...`);
      const txIncluded = await txSent.safeWait();
      console.log(
        `${description ?? ""} tx included into block: hash: ${
          txIncluded.hash
        } status: ${txIncluded.status}`
      );
      return undefined;
    } else return txSent;
  } catch (error) {
    if (chain !== "zeko") console.error("Error sending tx", error);
  }
  if (chain !== "local") await sleep(10000);
}

export async function getTxStatusFast(params: {
  hash: string;
}): Promise<{ success: boolean; result?: boolean; error?: string }> {
  if (chain === "local" || chain === "zeko")
    return { success: true, result: true };
  const { hash } = params;

  try {
    const txStatus = await checkZkappTransaction(hash);
    return {
      success: true,
      result: txStatus?.success ?? false,
    };
  } catch (error: any) {
    console.error(
      "getTxStatusFast error while getting tx status - catch",
      hash,
      error
    );
    return { success: false, error: error?.message ?? "Cannot get tx status" };
  }
}
