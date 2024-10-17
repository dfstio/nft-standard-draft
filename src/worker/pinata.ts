import { PINATA_JWT } from "../../env.json";

export async function fetchPins(
  maxPins: number | undefined = undefined
): Promise<any[]> {
  const PIN_QUERY = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1000&includeCount=false`;

  const wait = (milliseconds: number) => {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  };
  try {
    console.log("Fetching pins...");
    let pinHashes: any[] = [];
    let pageOffset = 0;
    let hasMore = true;
    let count = 0;

    while (hasMore === true && count < 10) {
      try {
        const response = await fetch(`${PIN_QUERY}&pageOffset=${pageOffset}`, {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: "Bearer " + PINATA_JWT,
          },
        });
        const responseData = await response.json();
        //console.log(responseData);
        const rows = responseData?.rows;

        if (rows === undefined || rows?.length === 0) {
          hasMore = false;
        } else {
          pinHashes.push(...rows);
          const itemsReturned = rows.length;
          pageOffset += itemsReturned;
          console.log("Page offset: ", pageOffset);
          await wait(300);
          if (maxPins !== undefined && pinHashes.length >= maxPins)
            hasMore = false;
        }
      } catch (error) {
        console.log(error);
        break;
      }
    }
    console.log("Total pins fetched: ", pinHashes.length);
    return pinHashes;
  } catch (error) {
    console.log(error);
    return [];
  }
}

export async function fetchPin(pin: string): Promise<any> {
  const PIN_QUERY = `https://api.pinata.cloud/data/pinList?status=pinned&cid=${pin}`;

  const wait = (milliseconds: number) => {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  };
  try {
    //console.log("Fetching pins...");
    let pinHashes: any[] = [];
    let pageOffset = 0;
    let hasMore = true;
    let count = 0;

    while (hasMore === true && count < 10) {
      try {
        const response = await fetch(`${PIN_QUERY}&pageOffset=${pageOffset}`, {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: "Bearer " + PINATA_JWT,
          },
        });
        const responseData = await response.json();
        //console.log(responseData);
        const rows = responseData?.rows;

        if (rows === undefined || rows?.length === 0) {
          hasMore = false;
        } else {
          pinHashes.push(...rows);
          const itemsReturned = rows.length;
          pageOffset += itemsReturned;
          //console.log("Page offset: ", pageOffset);
          await wait(300);
        }
      } catch (error) {
        console.log(error);
        break;
      }
    }
    //console.log("Total pins fetched: ", pinHashes.length);
    if (pinHashes.length > 1) {
      console.error("Error: wrong number of pins:", pinHashes.length);
      return undefined;
    }
    if (pinHashes.length === 0) {
      return undefined;
    }
    return pinHashes[0];
  } catch (error) {
    console.log(error);
    return undefined;
  }
}

export async function pinToPinata(params: {
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
}): Promise<string | undefined> {
  const { hash, keyvalues } = params;
  try {
    const pinataData = {
      hashToPin: hash,
      pinataMetadata: {
        keyvalues,
      },
    };

    const options = {
      method: "POST",
      headers: {
        Authorization: "Bearer " + PINATA_JWT,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pinataData),
    };

    const response = await fetch(
      "https://api.pinata.cloud/pinning/pinByHash",
      options
    );
    const result = await response.json();
    return result;
  } catch (error: any) {
    console.error("pinToPinata error:", error?.message, params);
    return undefined;
  }
}
