import React, { useState } from "react";
import { Button } from "@chakra-ui/react";
import { toFunctionSelector, getAbiItem } from "viem";
import { floatToBigInt } from "@/lib/utils/format";
import {
  toMultichainNexusAccount,
  createMeeClient,
  meeSessionActions,
  toSmartSessionsModule,
  getSudoPolicy,
  getMEEVersion,
  MEEVersion,
  stringify,
} from "@biconomy/abstractjs";
import { createSmartAccountClient } from "@biconomy/account";
import { base } from "@wagmi/core/chains";
import { http } from "@wagmi/core";
import { useAccount, useWalletClient } from "wagmi";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, parseUnits} from "viem";
import { USDC_ABI } from "../../../smartContracts/USDC";
import { counterABI } from "../../../smartContracts/counter";

const V2_BUNDLER = process.env.NEXT_PUBLIC_V2_BUNDLER_URL;
const PAYMASTER = process.env.NEXT_PUBLIC_PAYMASTER_API_KEY;
const USDC = process.env.NEXT_PUBLIC_BASE_USDC;
const FUTURES = process.env.NEXT_PUBLIC_BASE_FUTURES_ADDRESS;
const RPC_URL = process.env.NEXT_PUBLIC_BASE_CHAINSTACK_HTTP_URL;
const API_KEY = process.env.NEXT_PUBLIC_V3_API_KEY;
const LOG = (...args) => console.log("[PLAYGROUND]", ...args);
const Quantity = parseUnits('0.5', 6);

export default function SessionPlayground() {
  const { address: eoa, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [ownerMee, setOwnerMee] = useState(null);
  const [ownerSession, setOwnerSession] = useState(null);
  const [smartAccountAddress, setSmartAccountAddress] = useState(null);
  const [sessionPk, setSessionPk] = useState(null);
  const [sessionClient, setSessionClient] = useState(null);
  const [sessionDetailsArray, setSessionDetailsArray] = useState([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const display = (m) => setLog((prev) => [...prev, m]);

  const assertConnected = () => {
    if (!isConnected || !walletClient) throw new Error("Conecta una wallet primero");
  };

  // 1) Crear/recuperar Nexus con OWNER (EOA)
  const step1_ownerNexus = async () => {
    setBusy(true);
    try {
        assertConnected();
        display("Creating smart Account Client.");
        const biconomySmartAccount = await createSmartAccountClient({
            signer: walletClient,
            bundlerUrl: V2_BUNDLER,
            biconomyPaymasterApiKey: PAYMASTER,
        });

        const accountAddr = await biconomySmartAccount.getAccountAddress();
        const isDeployed = await biconomySmartAccount.isAccountDeployed();

        if (!isDeployed) {
            // No V2 account meaning new Nexus account.
            display("Account not deployed.");
            display("Creando Nexus (OWNER)...");
            const orchestrator = await toMultichainNexusAccount({
                chainConfigurations: [
                    {
                    chain: base,
                    transport: http(RPC_URL),
                    version: getMEEVersion(MEEVersion.V2_1_0)
                    }
                ],
                signer: walletClient,
            });

            const meeClient = await createMeeClient({ 
                account: orchestrator, 
                apiKey: API_KEY
            });

            const address = meeClient.account.deployments[0].address;
            const session = meeClient.extend(meeSessionActions);

            display("Nexus (OWNER) address created");
            LOG("Nexus (OWNER) address: ", address)
            display("Mee (OWNER) created");
            LOG("Mee (OWNER):", meeClient);
            setOwnerMee(meeClient);
            setOwnerSession(session);
            setSmartAccountAddress(address);
            
            display("Step1 finished.");
            return;
        }
        // V2 account migrated.
        display("Account already disployed")
        display("Creando Nexus (OWNER)...");
        const orchestrator = await toMultichainNexusAccount({
            chainConfigurations: [
                {
                chain: base,
                transport: http(RPC_URL),
                version: getMEEVersion(MEEVersion.V2_1_0)
                }
            ],
            signer: walletClient,
            accountAddress: accountAddr,
        });

        const meeClient = await createMeeClient({ 
            account: orchestrator, 
            apiKey: API_KEY
        });

        const address = meeClient.account.deployments[0].address;
        const session = meeClient.extend(meeSessionActions);
        display("Nexus (OWNER) address created");
        display("Mee (OWNER) created");
        LOG("Nexus (OWNER) address:", address);
        LOG("Mee (OWNER):", meeClient);
        setOwnerMee(meeClient);
        setOwnerSession(session);
        setSmartAccountAddress(address);
        display("Step1 finished.");
    } catch (e) {
        console.error(e);
        display(`ERROR step1: ${e.message}`);
    } finally {
        setBusy(false);
    }
  };

  // 2) prepareForPermissions (OWNER)
  const step2_prepare = async () => {
    setBusy(true);
    try {
        assertConnected();
        if (!ownerSession || !smartAccountAddress) throw new Error("Falta ownerSession / smartAccountAddress");

        display("Generating private key and private key account");
        const privateKey = generatePrivateKey();
        const privateKeyAccount = privateKeyToAccount(privateKey);
        const ssValidator = toSmartSessionsModule({ 
            signer: privateKeyAccount 
        });

        display("Private Key created");
        display("Private Key Account created");
        LOG("Private Key: ", privateKey);
        LOG("Private Key Account: ", privateKeyAccount);

        window.localStorage.setItem(`sessionPKey-${smartAccountAddress}`, privateKey);
        setSessionPk(privateKey);
        display("sessionPKey stored in localstorage.");
        
        display("Prepare for permissions...");
        const prep = await ownerSession.prepareForPermissions({
            smartSessionsValidator: ssValidator,
            sponsorship: true,
            feeToken: { address: USDC, chainId: base.id },
        });
        
        if (prep?.hash) {
            display(`Esperando receipt prepareForPermissions: ${prep.hash}`);
            await ownerSession.waitForSupertransactionReceipt({ hash: prep.hash, confirmations: 1 });
        }
        display("OK prepareForPermissions");
        display("Step2 finished.");
    } catch (e) {
        console.error(e);
        display(`ERROR step2: ${e.message}`);
    } finally {
        setBusy(false);
    }
  };

  const bigIntReplacer = (key, value) => {
    return typeof value === 'bigint' ? value.toString() : value;
  };
  // 3) grantPermissionTypedDataSign (OWNER)
  const step3_grant = async () => {
    setBusy(true);
    try {
        assertConnected();
        if (!ownerSession || !smartAccountAddress) throw new Error("Falta ownerSession / smartAccountAddress");

        display("Generating private key and private key account");
        const privateKey = window.localStorage.getItem(`sessionPKey-${smartAccountAddress}`);
        const privateKeyAccount = privateKeyToAccount(privateKey);

        const res = await ownerSession.grantPermissionTypedDataSign({
            redeemer: privateKeyAccount.address,
            feeToken: { address: USDC, chainId: base.id },
            actions: [
            {
                chainId: base.id,
                actionTarget: "0xCe219745Dc3439fB6892BFF2E7F69009DCb955C1",
                actionTargetSelector: toFunctionSelector(getAbiItem({ abi: counterABI, name: "incrementCount" })),
                actionPolicies: [getSudoPolicy()],
            },
            {
                chainId: base.id,
                actionTarget: "0xF1143f3A8D76f1Ca740d29D5671d365F66C44eD1", //process.env.NEXT_PUBLIC_BASE_USDC,
                actionTargetSelector: toFunctionSelector(getAbiItem({ abi: USDC_ABI, name: "transfer" })),
                actionPolicies: [getSudoPolicy()],
            },
            ],
        });

        setSessionDetailsArray(res);
        window.localStorage.setItem(`sessionDetails-${smartAccountAddress}`, JSON.stringify(res, bigIntReplacer));
        display("sessionDetails stored in localstorage.");
        display("OK grantPermissionTypedDataSign");
        LOG("grantPermissionTypedDataSign:", res);
        display("Step3 finished.");
    } catch (e) {
        console.error(e);
        display(`ERROR step3: ${e.message}`);
    } finally {
        setBusy(false);
    }
  };

  // 4) Build sessionClient with Pk
  const step4_buildSessionClient = async () => {
    setBusy(true);
    try {
        assertConnected();
        if (!smartAccountAddress) throw new Error("Falta smartAccountAddress");
        
        let pk = sessionPk || window.localStorage.getItem(`sessionPKey-${smartAccountAddress}`);
        if (!pk) throw new Error("No hay session pk (ejecuta step2 y step3)");

        display("Creating Nexus (SIGNER)...")
        const sessionSignerAccount = privateKeyToAccount(pk);
        const orchestrator = await toMultichainNexusAccount({
            chainConfigurations: [
            {
                chain: base,
                transport: http(RPC_URL),
                version: getMEEVersion(MEEVersion.V2_1_0),
            },
            ],
            accountAddress: smartAccountAddress,
            signer: sessionSignerAccount,
        });

        const meeClient = await createMeeClient({ 
            account: orchestrator, 
            apiKey: API_KEY 
        });

        const sessionClient = meeClient.extend(meeSessionActions);
        const address = meeClient.account.deployments[0].address;
        display("Nexus (SIGNER) address created");
        display("Mee (SIGNER) created");
        LOG("Nexus (SIGNER) address:", address);
        LOG("Mee (SIGNER):", sessionClient);
        setSessionClient(sessionClient);

        display("OK session client done");
        display("Step4 finished.");
    } catch (e) {
        console.error(e);
        display(`ERROR step4: ${e.message}`);
    } finally {
        setBusy(false);
    }
  };

  const bigIntReviver = (key, value) => {
    if (key === 'chainId' && typeof value === 'string') {
        return BigInt(value);
    }
    return value;
  };
  // 5) ENABLE AND USE
  const step5_enable = async () => {
    setBusy(true);
    try {
        assertConnected();
        if (!sessionClient) throw new Error("Falta sessionClient (step4)");
        LOG(sessionDetailsArray)
        let arr = JSON.parse(window.localStorage.getItem(`sessionDetails-${smartAccountAddress}`), bigIntReviver)// || sessionDetailsArray;
        if (!arr) throw new Error("No hay sessionDetails (step3)");
        LOG(arr)

        display("ENABLE AND USE...");
        display("Creating transaction: ")

        const data = encodeFunctionData({
            abi: USDC_ABI,
            functionName: "transfer",
            args: ["0x74eB71B215204Aa17f10bd7CaA32930Cdcf60B9A", floatToBigInt(0.000005, 18)],
        });

        const tx = {
            to: "0xF1143f3A8D76f1Ca740d29D5671d365F66C44eD1", //process.env.NEXT_PUBLIC_BASE_USDC,
            data: data,
        };

        const sendOneUSDCInstruction = {
            chainId: base.id,
            calls: [tx]
        };

        // display("getQuote...");
        // const quote = await sessionClient.getQuote({
        //     feeToken: {
        //         address: process.env.NEXT_PUBLIC_BASE_USDC,
        //         chainId: base.id
        //     },
        //     instructions: [sendOneUSDCInstruction],
        // });

        // display("getQuote work");
        // LOG("Quote result: ", quote);

        display("Sending transaction...")
        const usePermissionPayload = await sessionClient.usePermission({
            //sponsorship: true,
            sessionDetails: arr,
            mode: "ENABLE_AND_USE",
            instructions: [sendOneUSDCInstruction],
            feeToken: { address: USDC, chainId: base.id },
        });

        display("Waiting for receipt...")
        const receipt = await ownerMee.waitForSupertransactionReceipt({
            hash: usePermissionPayload.hash
        })

        display("Ok waitForSuperTransactionReceipt");
        LOG("Session Client: ", sessionClient)
        LOG("Payload: ", usePermissionPayload)
        LOG("waitForSuperTransactionReceipt: ", receipt);
        display("Step5 finished.");
    } catch (e) {
        console.error(e);
        display(`ERROR step5: ${e.message}`);
    } finally {
        setBusy(false);
    }
  };

  // 6) USE de prueba
  const step6_use = async () => {
    setBusy(true);
    try {
        assertConnected();
        if (!sessionClient) throw new Error("Falta sessionClient (step4)");
        let arr = JSON.parse(window.localStorage.getItem(`sessionDetails-${smartAccountAddress}`), bigIntReviver)// || sessionDetailsArray;
        if (!arr) throw new Error("No hay sessionDetails (step3)");

        display("USE...");
        display("Creating transaction...")

        // const data = encodeFunctionData({
        //     abi: counterABI,
        //     functionName: "incrementCount",
        //     args: [],
        // });

        // const tx = {
        //     to: "0xCe219745Dc3439fB6892BFF2E7F69009DCb955C1",
        //     data: data,
        // };

        const data = encodeFunctionData({
            abi: USDC_ABI,
            functionName: "transfer",
            args: ["0x74eB71B215204Aa17f10bd7CaA32930Cdcf60B9A", floatToBigInt(1.0)],
        });

        const tx = {
            to: process.env.NEXT_PUBLIC_BASE_USDC,
            data: data,
        };

        const sendOneUSDCInstruction = {
            chainId: base.id,
            calls: [tx]
        };

        display("Sending transaction...")
        const usePermissionPayload = await sessionClient.usePermission({
            //sponsorship: true,
            sessionDetails: arr,
            mode: "USE",
            instructions: [sendOneUSDCInstruction],
            feeToken: { address: USDC, chainId: base.id },
        });

        display("Waiting for receipt...")
        const receipt = await ownerMee.waitForSupertransactionReceipt({
            hash: usePermissionPayload.hash
        })

        display("Ok waitForSuperTransactionReceipt");
        LOG("waitForSuperTransactionReceipt: ", receipt);
        display("Step6 finished.");
    } catch (e) {
        console.error(e);
        display(`ERROR step6: ${e.message}`);
    } finally {
        setBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, color: "white" }}>
      <p>Session testing</p>
      <p>EOA: {eoa || "(desconectado)"} </p>
      <p>SA (Nexus): {smartAccountAddress || "(desconectado)"}</p>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 12 }}>
        <Button onClick={step1_ownerNexus} isDisabled={!isConnected || busy}>1) Owner Nexus</Button>
        <Button onClick={step2_prepare} isDisabled={!ownerSession || busy}>2) prepareForPermissions</Button>
        <Button onClick={step3_grant} isDisabled={!ownerSession || busy}>3) grantPermission</Button>
        <Button onClick={step4_buildSessionClient} isDisabled={!smartAccountAddress || busy}>4) Build session client</Button>
        <Button onClick={step5_enable} isDisabled={!sessionClient || busy}>5) ENABLE AND USE</Button>
        <Button onClick={step6_use} isDisabled={!sessionClient || busy}>6) USE</Button>
      </div>

      <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", background: "#111", color: "#ddd", padding: 12, borderRadius: 8, minHeight: 150 }}>
        {log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
