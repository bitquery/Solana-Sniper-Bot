const {
  Connection,
  PublicKey,
  VersionedTransaction,
  Keypair,
} = require("@solana/web3.js");
const fetch = require("cross-fetch"); // Use cross-fetch for both browser and Node environments
const lodash = require("lodash");
const { Wallet } = require("@project-serum/anchor");
const bs58 = require("bs58");

const gql = (strings, ...values) =>
  strings.reduce((final, str, i) => final + str + (values[i] || ""), "");

const query = gql`
  {
    Solana {
      Instructions(
        where: {
          Transaction: { Result: { Success: true } }
          Instruction: {
            Program: {
              Method: { is: "initializeUserWithNonce" }
              Address: { is: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8" }
            }
          }
        }
        limit: { count: 1 }
        orderBy: { ascending: Block_Date }
      ) {
        Instruction {
          Accounts {
            Address
          }
        }
      }
    }
  }
`;

const connection = new Connection("https://api.mainnet-beta.solana.com");
const walletPublicKey = new PublicKey(
  "E9LbF7KQNCsduB77pMBodQ14Vr27994qLxbZJ4S4jEHu"
);
const secretKeyUint8Array = new Uint8Array([24, 159, 174, 60, 171]); //add private key 
const wallet = new Wallet(Keypair.fromSecretKey(secretKeyUint8Array));

async function fetchGraphQL(query) {
  const response = await fetch("https://streaming.bitquery.io/eap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer ory_at_...",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
}

async function getPoolAddresses() {
  try {
    const data = await fetchGraphQL(query);
    const instructions = lodash.get(data, "data.Solana.Instructions", []);

    return instructions.map(({ Instruction: { Accounts } }) => ({
      poolAddress: Accounts.length > 4 ? Accounts[4].Address : undefined,
      tokenA: Accounts.length > 8 ? Accounts[8].Address : undefined,
      tokenB: Accounts.length > 9 ? Accounts[9].Address : undefined,
    }))[0];
  } catch (error) {
    console.error("Error fetching data:", error);
    return { poolAddress: "", tokenA: "", tokenB: "" };
  }
}

async function swapTokens(tokenA, tokenB) {
  try {
    const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${tokenB}&outputMint=${tokenA}&amount=10000&slippageBps=150`;
    console.log("quote url ", quoteUrl);
    const quoteResponse = await fetch(quoteUrl);
    const quoteData = await quoteResponse.json();
    if (
      quoteData["errorCode"] != "TOKEN_NOT_TRADABLE" &&
      quoteData["errorCode"] != "COULD_NOT_FIND_ANY_ROUTE"
    ) {
      const swapTransactionResponse = await fetch(
        "https://quote-api.jup.ag/v6/swap",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteResponse: quoteData,
            userPublicKey: wallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
          }),
        }
      );

      const { swapTransaction } = await swapTransactionResponse.json();

      const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
      console.log("swapTransactionBuf ", swapTransactionBuf);
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([wallet.payer]);
      const rawTransaction = transaction.serialize();
      const txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 4,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      });

      const confirmation = await connection.confirmTransaction(
        txid,
        "confirmed"
      );
      console.log(
        `Transaction confirmed: ${confirmation.value.err ? "Error" : "Success"}`
      );
      console.log(`Transaction successful: https://solscan.io/tx/${txid}`);
    }
  } catch (error) {
    console.error("Error during token swap:", error);
  }
}

async function main() {
  const { tokenA, tokenB } = await getPoolAddresses();
  await swapTokens(tokenA, tokenB);
}

main();
