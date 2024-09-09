import { Contract, ethers } from "ethers";
import "dotenv/config";
import { Permit2Abi } from "./abis/PermitAbi.js";
import { DENDE_VAULT_CONTRACT_ADDRESS } from "./constants.js";

const API_URL_BASE_0x = "https://api.0x.org/swap/permit2/";
const API_KEY_0x = process.env.API_KEY_0x;
const USER_ADDRESS = process.env.PUBLIC_KEY;
const privateKey = process.env.PRIVATE_KEY;
const op_usdc = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";
const op_mpETH = "0x819845b60a192167ed1139040b4f8eca31834f27";
const permit2Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const provider = new ethers.JsonRpcProvider("https://sepolia-rpc.kakarot.org");
const opProvider = new ethers.InfuraProvider(
  "optimism",
  process.env.INFURA_API_KEY
);

const DENDE_VAULT_ABI = [
  "function _deposit(uint _assets, uint chainId, address crossAsset, uint amount) public returns (uint256)",
  "function symbol() view returns (string)",
  "event BuyStrategy(uint256 chainId, address crossAsset, uint256 amount)",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function allowance(address owner, address spender) public view returns (uint256)",
  "function balanceOf(address account) public view returns (uint256)",
  "function transfer(address recipient, uint256 amount) public returns (bool)",
];

const VaultContract = new Contract(
  DENDE_VAULT_CONTRACT_ADDRESS,
  DENDE_VAULT_ABI,
  provider
);

const UsdcContract = new Contract(op_usdc, ERC20_ABI, opProvider);

const Permit2Contract = new Contract(permit2Address, Permit2Abi, opProvider);

const getContractInstance = async (address, abi, signer) => {
  return new Contract(address, abi, signer);
};

const getOrderParams = (chainId, assetAddress) => {
  const orderParams = new URLSearchParams();
  orderParams.append("chainId", chainId); // / op mainnet. See the 0x Cheat Sheet for all supported endpoints: https://0x.org/docs/introduction/0x-cheat-sheet
  orderParams.append("sellToken", op_usdc); //usdc
  orderParams.append("buyToken", assetAddress); //mpETH
  orderParams.append("sellAmount", "1000000"); // Note that the WETH token uses 18 decimal places, so `sellAmount` is `100 * 10^18`.
  orderParams.append("taker", USER_ADDRESS); //Address that will make the trade
  return orderParams;
};

export const approveSwap = async (chainId, assetAddress, amount) => {
  try {
    const wallet = new ethers.Wallet(privateKey, opProvider);

    const signer = wallet.connect(opProvider);
    // console.log("Signer:", signer)
    const orderParams = getOrderParams(chainId, assetAddress);
    const UsdcContract = await getContractInstance(op_usdc, ERC20_ABI, signer);

    await fetch(`${API_URL_BASE_0x}/price?${orderParams.toString()}`, {
      headers: {
        "Content-Type": "application/json",
        "0x-version": "2",
        "0x-api-key": API_KEY_0x,
      },
      method: "GET",
    }).then(async (res) => {
      // console.log("Price:", await res.json());
      const allowance = UsdcContract.allowance(
        USER_ADDRESS,
        permit2Address
      ).toString();

      if (res.ok) {
        if (1000000 > Number(allowance))
          try {
            const request = await UsdcContract.approve.staticCall(
              permit2Address,
              1000000
            );
            console.log("Approving Permit2 to spend USDC...", request);
            // If not, write approval
            const hash = await UsdcContract.approve(permit2Address, 1000000);
            console.log("Approved Permit2 to spend USDC.", await hash.wait());
          } catch (error) {
            console.log("Error approving Permit2:", error);
          }
        else {
          console.log("USDC already approved for Permit2");
        }
      }
    });
  } catch (error) {
    console.log("[Error] !!! ", error);
  }
};

export const makeSwap = async (chainId, assetAddress) => {
  try {
    const wallet = new ethers.Wallet(privateKey, opProvider);

    const signer = wallet.connect(opProvider);
    
    const orderParams = getOrderParams(chainId, assetAddress);
    const response = await fetch(`${API_URL_BASE_0x}/quote?${orderParams.toString()}`, {
      headers: {
        "Content-Type": "application/json",
        "0x-version": "2",
        "0x-api-key": API_KEY_0x,
      },
      method: "GET",
    });
   
      const data = await response.json();
      console.log("Data:", data);
      const {transaction, permit2 } = data;
      const { domain, types, message } = permit2.eip712;
      console.log("Domain:", domain);
      console.log("Types:", types);
      console.log("Message:", message);
      const signature = await signer.signTypedData(domain, { TokenPermissions: [...types.TokenPermissions], PermitTransferFrom: types.PermitTransferFrom }, message);
      // console.log("Signature:", signature);

      if (signature && transaction?.data) {
        const signatureLengthInHex = ethers.hexlify(ethers.zeroPadBytes(ethers.toBeArray(signature.length), 32));
        // console.log("Signature length in hex: ", signatureLengthInHex);
        // Concatenate transaction.data with signature length and signature
        const dataWithSignature = ethers.concat([
            transaction.data,                        // Existing transaction data
            signatureLengthInHex,                    // Signature length in hex
            signature                                // Signature
        ]);
        // console.log("Data with signature: ", dataWithSignature);
        transaction.data = dataWithSignature;
        
        const nonce = await opProvider.getTransactionCount(signer.address, "latest");
        const signedTx = signer.signTransaction({
            account: signer.address,
            chain: chainId,
            gas: !!transaction.gas
            ? BigInt(transaction.gas)
            : undefined,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value
            ? BigInt(transaction.value)
            : undefined, // value is used for native tokens
            gasPrice: !!transaction.gasPrice
            ? BigInt(transaction.gasPrice)
            : undefined,
            nonce,
        });
        const txResponse = await signer.sendTransaction(signedTx);
        const receipt = await txResponse.wait();
        console.log("Transaction hash:", receipt);

        console.log(`See tx details at https://optimistic.etherscan.io/tx/${receipt?.hash}`);
      } else {
        throw new Error("Failed to obtain signature or transaction data");
      }
  } catch (error) {
    console.log("[Error] !!! ", error);
  }
};

//approveSwap("10", op_mpETH, 100);
makeSwap("10", op_mpETH);
