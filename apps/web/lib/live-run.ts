/**
 * The transactions sent to Diana testnet on 2026-11-14 (see docs/LIVE_RUN_2026-11-14.md).
 * `expect` is what the run was supposed to do; the proof page re-reads each transaction from the chain and
 * compares, so a wrong hash or a different outcome shows up as a mismatch instead of being hidden.
 */
export type Lane = "native" | "evm";
export interface RunTx { group: string; label: string; lane: Lane; hash: string; expect: "success" | "reverted"; reason?: string }

const h = (x: string) => x;

export const RUN: RunTx[] = [
  // Post-quantum identity and authorisation windows (native lane, hybrid signed except the key registration)
  { group: "Post-quantum identity", label: "Register deployer ML-DSA-87 key", lane: "native", hash: h("EFDCBBEEADDA81C4B6BF29E78451B036B30AC334DC32D7024B8AB213770C8E75"), expect: "success" },
  { group: "Post-quantum identity", label: "Open unscoped EVM window (hybrid-signed)", lane: "native", hash: h("12E7BA994B9A1147EACE480C36A0D76FDA730B843B78B90E6B4EEA19304E4F15"), expect: "success" },
  { group: "Post-quantum identity", label: "Close EVM window after deploy", lane: "native", hash: h("21AEAF9698F0C0CA03254708439C5ECEA8C7AE55BE5E877C33EB58FC2C13F3EA"), expect: "success" },
  { group: "Post-quantum identity", label: "Fund agent account with 3 QOR", lane: "native", hash: h("4FD30B565C5434EBAE36001A410D48898AE0FB485B3CA562127B50719993ED16"), expect: "success" },
  { group: "Post-quantum identity", label: "Register agent ML-DSA-87 key", lane: "native", hash: h("9EA7D559EF3B857C678C2EDDD2FBBAEC125D8E9191437B9EE1F079EBA34CDA1E"), expect: "success" },
  { group: "Post-quantum identity", label: "Open EVM windows, deployer and agent (1)", lane: "native", hash: h("6B55DA23C631B09CC9017C89DDE693C4B1279EF6FFE5A07EB6FE668BC3FBF78D"), expect: "success" },
  { group: "Post-quantum identity", label: "Open EVM windows, deployer and agent (2)", lane: "native", hash: h("0815A547507889ABA495967A70D5397367B4A6BF89D31867D4ED73F406E04649"), expect: "success" },
  { group: "Post-quantum identity", label: "Close EVM windows (1)", lane: "native", hash: h("EA0B3C4D4D5458F3DBDC8FD7F962903E5B387B3C8561D054CADEF452A4EC8F0D"), expect: "success" },
  { group: "Post-quantum identity", label: "Close EVM windows (2)", lane: "native", hash: h("345038A843D778F5CF19BDB26202B15BB71D3BD2BFC396619401C175DA1B0CE6"), expect: "success" },
  { group: "Post-quantum identity", label: "Open EVM windows for escrow run (1)", lane: "native", hash: h("268AADB8DA50973F682A2E9287EB368ED97E1EF7EC33FC7201593B1735B9BC9C"), expect: "success" },
  { group: "Post-quantum identity", label: "Open EVM windows for escrow run (2)", lane: "native", hash: h("8B56B49D4D146E4A2103E6B3239EB034AE281BB02E642BF31619200B6922F326"), expect: "success" },
  { group: "Post-quantum identity", label: "Close EVM windows after escrow run (1)", lane: "native", hash: h("ECF57DD680F51582EFE4AF8AB215F63EAD3E7A866927C8E1547EC980B6974A79"), expect: "success" },
  { group: "Post-quantum identity", label: "Close EVM windows after escrow run (2)", lane: "native", hash: h("BF9079DC72B1993B597B2798C96991A55382F16F2E4356498E24A7B6DFEDF117"), expect: "success" },

  // Contract deployment
  { group: "Deployment", label: "Deploy PolicyManager", lane: "evm", hash: h("0xdaae493070c48cfd413b6334daf06a8cf428d06ec3bd280678167d8a80529c91"), expect: "success" },
  { group: "Deployment", label: "Deploy TreasuryVault", lane: "evm", hash: h("0xcaf49894a6f85325ac18d6d0f2c142d3320c78a09375f17a1055279e047fe9fa"), expect: "success" },
  { group: "Deployment", label: "Deploy MilestoneEscrow", lane: "evm", hash: h("0xc38a903ecb2aba5fcf8e2bae3023f2f813e177790dd2888cb687945034cbf9ca"), expect: "success" },
  { group: "Deployment", label: "Deploy AuditAnchor", lane: "evm", hash: h("0xb9614e6a5d259d40ba2ebc43c7e94e5e43b711faa9b1a8bd22849017f82af658"), expect: "success" },
  { group: "Deployment", label: "Deploy OrganizationRegistry", lane: "evm", hash: h("0xaf0721f6d5371fe2170c6e2117a72acffb24987ec5cf9b35f058ae2bc32a5549"), expect: "success" },

  // Restricted agent spending
  { group: "Restricted agent payments", label: "Activate policy version 1", lane: "evm", hash: h("0xb1dfefdba9bdfe010bd3f2a561084afbdc7461655a1592f5c30a2ae3b79c5d72"), expect: "success" },
  { group: "Restricted agent payments", label: "Set agent limits: 10 QOR per payment, 20 per day", lane: "evm", hash: h("0x72e1325fb4225f1a3b567339bbf0073495364ee6e32f9a3a975485a594490591"), expect: "success" },
  { group: "Restricted agent payments", label: "Approve one recipient", lane: "evm", hash: h("0x6a6211fb50920611cd64626fce1165ee9150984a356331ade54589c87bc69ed2"), expect: "success" },
  { group: "Restricted agent payments", label: "Fund vault with 20 QOR", lane: "evm", hash: h("0x97c5e55df645681b3b01fe8e6d603c060da3e8b6f359258375fd20ae1b1e3562"), expect: "success" },
  { group: "Restricted agent payments", label: "ALLOWED: agent pays 5 QOR to approved recipient", lane: "evm", hash: h("0x3d7a64d19b630afc29949aac0500bc7e1812f810b9e4fea2a912b0636591fd5b"), expect: "success" },
  { group: "Restricted agent payments", label: "DENIED: agent tries 15 QOR (cap is 10)", lane: "evm", hash: h("0xbeb8d5639e5b3fa9e811fd773988cf519b15243a094de535c4e0dc4ec688171e"), expect: "reverted", reason: "ExceedsPerTxCap()" },
  { group: "Restricted agent payments", label: "DENIED: agent pays an unapproved recipient", lane: "evm", hash: h("0x05e7c3faa29365753c310fec1a36a54bd9b7443bb046305255ea614b63f42e16"), expect: "reverted", reason: "InsufficientApprovals(0, 1)" },

  // Human-approved escrow and milestone release
  { group: "Escrow and milestone release", label: "Allow deployer to create escrow projects", lane: "evm", hash: h("0x653ad20ba23e11005d64b6f90712a8dc257ad35fa1b6658cdf06fb3cba6f990c"), expect: "success" },
  { group: "Escrow and milestone release", label: "Register escrow with the vault", lane: "evm", hash: h("0xc55f62c4b2c2a639c6f657fd925f74eb0302c11427b4227e9bf07b99cf72df6a"), expect: "success" },
  { group: "Escrow and milestone release", label: "Create project: payer vault, one 60 QOR milestone", lane: "evm", hash: h("0xd952ac091354163ddcec9b62a4a77b8bb6a33ab86102e84930c11886afb1d3d7"), expect: "success" },
  { group: "Escrow and milestone release", label: "Deposit 55 QOR into the vault", lane: "evm", hash: h("0xd5e81b731eed71215dd6f49ef9cc5246d3687309b8f34572ddf042c71e5f2ce6"), expect: "success" },
  { group: "Escrow and milestone release", label: "Raise agent cap to 60 QOR", lane: "evm", hash: h("0xcec963e97df2ba586b6d526df015055065e3b17bbd0a7e07bf9681bd07a54ffa"), expect: "success" },
  { group: "Escrow and milestone release", label: "Register a human approver", lane: "evm", hash: h("0x2e2e0d6c55042828c93f43bee146a35ffcf00f7925bad9f00a35558257be0050"), expect: "success" },
  { group: "Escrow and milestone release", label: "DENIED: agent funds escrow 60 QOR without approval", lane: "evm", hash: h("0xcdaa77d51577a2cb54d0aa6277ff4595139a77231e12b483120ea2e2a1a78440"), expect: "reverted", reason: "InsufficientApprovals(0, 1)" },
  { group: "Escrow and milestone release", label: "Approver approves that exact payment", lane: "evm", hash: h("0xb0fddf24ad2a90524cb7b5a03da209e13e28cfc156c59351c8f33f45d6522119"), expect: "success" },
  { group: "Escrow and milestone release", label: "Agent funds escrow 60 QOR (approved)", lane: "evm", hash: h("0x0048eff44d50f3b531ed5227f84768d42cca000063331c6317f2d5aba87827e9"), expect: "success" },
  { group: "Escrow and milestone release", label: "DENIED: release before reviewer approval", lane: "evm", hash: h("0xc638e78c802f6eb9c456e333f5172f01b46523f56e305678c7c4fce54c2e65fe"), expect: "reverted", reason: "NotApproved()" },
  { group: "Escrow and milestone release", label: "Reviewer approves the milestone", lane: "evm", hash: h("0x612aec1b93f27e8a6a6d7989a66bcf3ed0b907c9aa8d6a40e9f6bada64e27450"), expect: "success" },
  { group: "Escrow and milestone release", label: "RELEASE: 60 QOR paid to the contractor", lane: "evm", hash: h("0xe4f370c707589f0e07deeeadc5fabb882faabd0a58a5695679ddfcc8a2c18d8a"), expect: "success" },
];

// 2026-11-15: owner setup for live execution (see docs/LIVE_SETUP_2026-11-15.md). Each was dry-run first and read back from the chain.
RUN.push(
  { group: "Live execution setup, 2026-11-15", label: "Owner opens a vault-only EVM window", lane: "native", hash: h("01FFA4EB67E7104C47442C4463D850ED95F813EBB779BC3674F93D776582E533"), expect: "success" },
  { group: "Live execution setup, 2026-11-15", label: "Agent limits set: 10 QOR per payment, 20 per day, no auto-approve", lane: "evm", hash: h("0x99a053ab48231f5cc2b3178572cb09d5235e4c98d754bea4606bd5f30838359d"), expect: "success" },
  { group: "Live execution setup, 2026-11-15", label: "Owner closes the window", lane: "native", hash: h("DF0770056DF9D618AE2F9517C4F3CF899901024029847D7015D0D4A32E2B9456"), expect: "success" },
  { group: "Live execution setup, 2026-11-15", label: "Fund the dedicated approver account with 3 QOR", lane: "native", hash: h("070B298989C01145604163E3FCB3612EAFE32A6F0293AEB561DED701354CEDDE"), expect: "success" },
  { group: "Live execution setup, 2026-11-15", label: "Register the approver's ML-DSA-87 key", lane: "native", hash: h("E11E283A7F256347C3B31F4EA99F80B149C9DEF5133C870828D0228A1C6A6FCF"), expect: "success" },
  { group: "Live execution setup, 2026-11-15", label: "Owner opens a vault-only EVM window", lane: "native", hash: h("C3180406886C9ED7325F228679FE21B82E98ACFAC43057617A209C442A10E94B"), expect: "success" },
  { group: "Live execution setup, 2026-11-15", label: "Approver account added to the vault (approver count 2)", lane: "evm", hash: h("0x51daf2af7cc8e62916750b50645ffce27bfed9a523df09d2f68970b93d3b2a44"), expect: "success" },
  { group: "Live execution setup, 2026-11-15", label: "Owner closes the window", lane: "native", hash: h("0FB3FCB7B34E6F7805AD347A9FCCAFC3B6978D62FACE054F43E40E8FCE5D5BAD"), expect: "success" },
);

// 2026-11-15: the first payment made from the website (see docs/LIVE_PAYMENT_2026-11-15.md). Requested by one user, approved by a second administrator.
RUN.push(
  { group: "First website payment, 2026-11-15", label: "Approval relayed by the server's approver key, bound to the payment hash", lane: "evm", hash: h("0x1bd9aa176131f7486eca60e0291837f290f58f3f4995cd1fd6c1c9b8453000ac"), expect: "success" },
  { group: "First website payment, 2026-11-15", label: "PAYMENT: 1 QOR to the approved recipient, executed by the bounded agent key", lane: "evm", hash: h("0x75ac37df6b0f686616559ee4028ca51f101bc75d037d0066426b44fe984c0636"), expect: "success" },
);
