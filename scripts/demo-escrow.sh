#!/usr/bin/env bash
# Live testnet demo: human-approved escrow funding through the vault, then reviewer-approved release of 60 QOR.
# Requires: deployed contracts (deployments/diana-testnet.json), .secrets/{testnet,agent}-account.json, and OPEN EVM
# windows for both accounts (pnpm chain:tx open-window). Throwaway testnet keys only. Prints tx hashes and statuses.
set -u
export PATH="$PATH:$HOME/.foundry/bin"
R=https://evm-testnet.qore.host
PM=0xE4ba9fBfB11Bb947284D7e08acec871Ad42a0ab1; V=0xa343930CE94b1d1629791823A75fb14a1D7C7Ab8; E=0xd577FFB031358d46B369E9fE293c5a21a1C1FA90
Z=0x0000000000000000000000000000000000000000
OWNER=0x5B108321e824faf53AA198fcD1682A07a68970F2; AGENT=0x7615DAb4651b47f69F80305f89F39B211F829dd7
PAYEE=0x200cad3c9de63d3613a33fc20b1ef31cb4dbf5af   # contractor (the user's original wallet)
key(){ node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$1','utf8')).secp256k1PrivateKey)"; }
OPK=$(key .secrets/testnet-account.json); APK=$(key .secrets/agent-account.json)
tx(){ local pk=$1; shift; cast send "$@" --rpc-url $R --private-key "$pk" --gas-limit 900000 --legacy 2>&1 | grep -E "^(status|transactionHash)|Error" | tr '\n' ' '; echo; }
now=$(date +%s); EXP=$((now+3600)); DEADLINE=$((now+86400*30)); VALID=$((now+86400))
Q=1000000000000000000

echo "1 escrow.setCreator(owner)";                 tx $OPK $E "setCreator(address,bool)" $OWNER true
echo "2 vault.setEscrow(escrow)";                  tx $OPK $V "setEscrow(address,bool)" $E true
echo "3 escrow.createProject payer=vault payee=contractor reviewer=owner milestone=[60 QOR]"
tx $OPK $E "createProject((address,address,address,address,uint8,uint64,bytes32,uint256[]))" "($V,$PAYEE,$OWNER,$Z,0,$DEADLINE,$(cast keccak 'tender-nova-001'),[60000000000000000000])"
PID=$(cast call $E "nextProjectId()(uint256)" --rpc-url $R); PID=$((PID-1)); echo "   projectId=$PID"
echo "4 vault.deposit 55 QOR";                     tx $OPK $V --value 55ether
echo "5 vault.setAgentLimits (perTx 60, daily 80, autoApprove 5)"; tx $OPK $V "setAgentLimits(address,address,uint128,uint128,uint128,uint64)" $AGENT $Z 60000000000000000000 80000000000000000000 5000000000000000000 $VALID
echo "6 vault.setApprover(owner)";                 tx $OPK $V "setApprover(address,bool)" $OWNER true
P="($Z,$E,60000000000000000000,$(cast keccak 'milestone-1-nova'),1,$EXP,100)"
echo "7 DENIED  agent fundEscrow 60 QOR before human approval"
tx $APK $V "fundEscrow((address,address,uint256,bytes32,uint64,uint64,uint256),uint256)" "$P" $PID
echo "8 human approver approves exactly this payment"; tx $OPK $V "approvePayment(address,(address,address,uint256,bytes32,uint64,uint64,uint256))" $AGENT "$P"
echo "9 agent fundEscrow 60 QOR (approved)";       tx $APK $V "fundEscrow((address,address,uint256,bytes32,uint64,uint64,uint256),uint256)" "$P" $PID
echo "10 DENIED release before reviewer approval";  tx $OPK $E "releaseMilestone(uint256,uint256)" $PID 0
echo "11 reviewer approves milestone";              tx $OPK $E "approveMilestone(uint256,uint256)" $PID 0
echo "12 release milestone -> contractor";          tx $OPK $E "releaseMilestone(uint256,uint256)" $PID 0
echo "contractor balance: $(cast balance $PAYEE --rpc-url $R)   escrow balance: $(cast balance $E --rpc-url $R)   vault: $(cast balance $V --rpc-url $R)"
echo "project state (0 None,1 Active,3 Completed): $(cast call $E 'getProject(uint256)((address,address,address,address,uint8,uint8,uint64,uint32,uint32,bool,uint256,uint256,uint256,uint256,bytes32))' $PID --rpc-url $R | tr '\n' ' ' | cut -c1-400)"
