import { test } from "node:test";
import assert from "node:assert/strict";
import { VENDORS, suggestCategory, suggestAccount, findVendor, foldText } from "../../src/core/rules.js";

// Identifiants des catégories livrées avec l'appli (section 3 du cahier des charges).
const CATEGORY_IDS = [
  "sales_shopify", "sales_other", "refunds", "other_income",
  "ads_meta", "ads_tiktok", "ads_applovin", "ads_google", "ads_other",
  "production_ai", "production_other",
  "shopify_sub", "shopify_apps", "fees_payment", "chargebacks",
  "email_sms", "software", "domain_hosting",
  "creators", "freelancers",
  "bank_fees", "legal_admin", "taxes",
  "shipping", "other_expense",
];

function configWith(extra = {}) {
  const categories = {};
  for (const id of CATEGORY_IDS) categories[id] = { id, name: id, kind: "expense", group: "other", system: true, order: 0, archived: false };
  return { v: 1, categories, rules: {}, accounts: {}, ...extra };
}

// Vérifie une table [libellé, catégorie attendue en sortie d'argent, tiers attendu].
function checkExpenses(table) {
  for (const [label, categoryId, party] of table) {
    const got = suggestCategory(null, { label, amountCents: -1000 });
    if (categoryId === null) {
      assert.equal(got, null, `${label} -> ${JSON.stringify(got)}`);
    } else {
      assert.ok(got, `${label} : aucune proposition`);
      assert.equal(got.categoryId, categoryId, label);
      assert.equal(got.party, party, label);
      assert.equal(got.via, "vendor", label);
      // même réponse avec une configuration complète
      assert.deepEqual(suggestCategory(configWith(), { label, amountCents: -1000 }), got, label);
    }
  }
}

test("foldText : minuscules, sans accents, sans ponctuation", () => {
  const table = [
    ["FACEBK *X7Y8Z9 fb.me/ads", "facebk x7y8z9 fb me ads"],
    ["  Café  Crème \u2014 Paris ", "cafe creme paris"],
    ["GOOGLE*ADS123", "google ads123"],
    ["Œuvre d'été", "oeuvre d ete"],
    ["", ""], [null, ""], [undefined, ""], [42, "42"],
  ];
  for (const [input, expected] of table) assert.equal(foldText(input), expected, JSON.stringify(input));
  assert.equal(foldText("x".repeat(5000)).length, 600);
});

test("VENDORS : forme du dictionnaire", () => {
  assert.ok(Array.isArray(VENDORS));
  assert.ok(VENDORS.length >= 400, `seulement ${VENDORS.length} entrées`);
  assert.ok(Object.isFrozen(VENDORS));
  for (const entry of VENDORS) {
    assert.ok(entry.re instanceof RegExp);
    assert.equal(entry.re.flags, "", String(entry.re));
    assert.ok(entry.party === null || (typeof entry.party === "string" && entry.party.length > 0));
    assert.ok(entry.categoryId === null || CATEGORY_IDS.includes(entry.categoryId), String(entry.categoryId));
    assert.ok(entry.positiveCategoryId === null || CATEGORY_IDS.includes(entry.positiveCategoryId), String(entry.positiveCategoryId));
    assert.ok(entry.categoryId || entry.positiveCategoryId, String(entry.re));
    // aucun motif ne reconnaît le texte vide ni un libellé quelconque
    assert.equal(entry.re.test(""), false, String(entry.re));
    assert.equal(entry.re.test("carte x1234 commerce inconnu paris fr"), false, String(entry.re));
  }
  const parties = VENDORS.map((v) => v.party).filter(Boolean);
  for (const name of ["Meta", "TikTok", "AppLovin", "Google Ads", "Shopify", "Klaviyo", "PayPal", "Stripe", "Canva", "CapCut", "OpenAI", "Anthropic",
    "ElevenLabs", "HeyGen", "Runway", "Kling AI", "Midjourney", "Higgsfield", "Google Veo", "Suno", "Namecheap", "GoDaddy", "Fiverr", "Upwork",
    "Wise", "Revolut", "Slash", "Stripe Atlas", "Northwest Registered Agent", "QuickBooks"]) {
    assert.ok(parties.includes(name), name);
  }
});

test("suggestCategory : régies pub", () => {
  checkExpenses([
    ["FACEBK *X7Y8Z9AB52 fb.me/ads", "ads_meta", "Meta"],
    ["FACEBOOK ADS", "ads_meta", "Meta"],
    ["FACEBOOKADS", "ads_meta", "Meta"],
    ["Meta Platforms Ireland Ltd", "ads_meta", "Meta"],
    ["META PLATFORMS, INC.", "ads_meta", "Meta"],
    ["FB.ME/ADS", "ads_meta", "Meta"],
    ["Instagram", "ads_meta", "Meta"],
    ["Pub Meta novembre", "ads_meta", "Meta"],
    ["TIKTOK ADS", "ads_tiktok", "TikTok"],
    ["TIKTOKADS", "ads_tiktok", "TikTok"],
    ["TikTok Pte. Ltd.", "ads_tiktok", "TikTok"],
    ["Tik Tok Information Technologies", "ads_tiktok", "TikTok"],
    ["Bytedance Pte", "ads_tiktok", "TikTok"],
    ["APPLOVIN CORPORATION", "ads_applovin", "AppLovin"],
    ["Receipt from Applovin Corporation Receipt #1182-9784", "ads_applovin", "AppLovin"],
    ["AXON by AppLovin", "ads_applovin", "AppLovin"],
    ["Axon", "ads_applovin", "AppLovin"],
    ["App Lovin", "ads_applovin", "AppLovin"],
    ["GOOGLE*ADS1234567890", "ads_google", "Google Ads"],
    ["Google Ads", "ads_google", "Google Ads"],
    ["GOOGLE ADWORDS", "ads_google", "Google Ads"],
    ["Googleads", "ads_google", "Google Ads"],
    ["YouTube Ads", "ads_google", "Google Ads"],
    ["SNAP INC ADS", "ads_other", "Snapchat"],
    ["Snapchat", "ads_other", "Snapchat"],
    ["Pinterest Ads", "ads_other", "Pinterest"],
    ["REDDIT ADS", "ads_other", "Reddit"],
    ["Microsoft Advertising", "ads_other", "Microsoft Advertising"],
    ["BING ADS", "ads_other", "Microsoft Advertising"],
    ["Taboola", "ads_other", "Taboola"],
    ["Apple Search Ads", "ads_other", "Apple Search Ads"],
    ["LinkedIn Ads", "ads_other", "LinkedIn"],
    ["Twitter Ads", "ads_other", "X (Twitter)"],
    ["Amazon Ads", "ads_other", "Amazon Ads"],
    // faux amis
    ["Metamask wallet", null],
    ["Metadata service", null],
    ["Google AdSense", null],
  ]);
});

test("suggestCategory : un encaissement venant d'une régie pub est un remboursement de la même catégorie", () => {
  const table = [
    ["FACEBK *REFUND", "ads_meta"], ["TikTok Ads refund", "ads_tiktok"], ["Applovin credit", "ads_applovin"], ["GOOGLE ADS", "ads_google"],
    ["Snapchat", "ads_other"],
  ];
  for (const [label, categoryId] of table) {
    assert.equal(suggestCategory(null, { label, amountCents: 5000 }).categoryId, categoryId, label);
    assert.equal(suggestCategory(null, { label, amountCents: -5000 }).categoryId, categoryId, label);
  }
});

test("suggestCategory : Shopify, abonnement en sortie et virement de ventes en entrée", () => {
  for (const label of ["SHOPIFY* 123456789", "Shopify", "SHOPIFY PAYMENTS PAYOUT", "Virement Shopify", "shopify.com"]) {
    assert.deepEqual(suggestCategory(null, { label, amountCents: -3900 }), { categoryId: "shopify_sub", party: "Shopify", via: "vendor" }, label);
    assert.deepEqual(suggestCategory(null, { label, amountCents: 125000 }), { categoryId: "sales_shopify", party: "Shopify", via: "vendor" }, label);
  }
  // sens inconnu ou montant nul : comme une sortie
  for (const amountCents of [undefined, null, 0, NaN, "abc"]) {
    assert.equal(suggestCategory(null, { label: "Shopify", amountCents }).categoryId, "shopify_sub", String(amountCents));
  }
  assert.equal(suggestCategory(null, { label: "Shopify" }).categoryId, "shopify_sub");
  // un montant positif passé en texte compte aussi
  assert.equal(suggestCategory(null, { label: "Shopify", amountCents: "125000" }).categoryId, "sales_shopify");
});

test("suggestCategory : apps Shopify", () => {
  checkExpenses([
    ["SHOPIFY APP STORE", "shopify_apps", "App Shopify"],
    ["Shopify apps", "shopify_apps", "App Shopify"],
    ["Loox Reviews", "shopify_apps", "Loox"],
    ["JUDGE.ME", "shopify_apps", "Judge.me"],
    ["PAGEFLY", "shopify_apps", "PageFly"],
    ["Replo", "shopify_apps", "Replo"],
    ["Recharge Payments", "shopify_apps", "Recharge"],
    ["Customily", "shopify_apps", "Customily"],
    ["Sky Pilot", "shopify_apps", "Sky Pilot"],
    ["Kaching Bundles", "shopify_apps", "Kaching Bundles"],
    // "recharge" tout court est un mot courant (recharge de compte)
    ["Recharge compte Revolut", null],
  ]);
});

test("suggestCategory : email et SMS", () => {
  checkExpenses([
    ["KLAVIYO INC", "email_sms", "Klaviyo"],
    ["Receipt from Klaviyo Inc", "email_sms", "Klaviyo"],
    ["Klaviyo, abonnement octobre", "email_sms", "Klaviyo"],
    ["MAILCHIMP", "email_sms", "Mailchimp"],
    ["Intuit Mailchimp", "email_sms", "Mailchimp"],
    ["Omnisend", "email_sms", "Omnisend"],
    ["TWILIO SENDGRID", "email_sms", "SendGrid"],
    ["Postscript", "email_sms", "Postscript"],
    ["Brevo", "email_sms", "Brevo"],
    ["SMSBump", "email_sms", "SMSBump"],
  ]);
});

test("suggestCategory : outils IA et montage (fabrication des films)", () => {
  checkExpenses([
    ["OPENAI *CHATGPT SUBSCR", "production_ai", "OpenAI"],
    ["ChatGPT Plus", "production_ai", "OpenAI"],
    ["Sora", "production_ai", "OpenAI"],
    ["ANTHROPIC", "production_ai", "Anthropic"],
    ["CLAUDE.AI SUBSCRIPTION", "production_ai", "Anthropic"],
    ["ELEVENLABS.IO", "production_ai", "ElevenLabs"],
    ["Eleven Labs", "production_ai", "ElevenLabs"],
    ["HEYGEN TECHNOLOGY INC", "production_ai", "HeyGen"],
    ["RUNWAY AI, INC", "production_ai", "Runway"],
    ["RUNWAYML", "production_ai", "Runway"],
    ["KLING AI", "production_ai", "Kling AI"],
    ["KLINGAI", "production_ai", "Kling AI"],
    ["MIDJOURNEY INC.", "production_ai", "Midjourney"],
    ["HIGGSFIELD", "production_ai", "Higgsfield"],
    ["Google Veo 3", "production_ai", "Google Veo"],
    ["VEO3", "production_ai", "Google Veo"],
    ["Google AI Studio", "production_ai", "Google Veo"],
    ["Gemini Advanced", "production_ai", "Google Veo"],
    ["SUNO INC", "production_ai", "Suno"],
    ["Udio", "production_ai", "Udio"],
    ["PIKA LABS", "production_ai", "Pika"],
    ["LUMA AI", "production_ai", "Luma AI"],
    ["Synthesia", "production_ai", "Synthesia"],
    ["D-ID", "production_ai", "D-ID"],
    ["LEONARDO.AI", "production_ai", "Leonardo.Ai"],
    ["Stability AI", "production_ai", "Stability AI"],
    ["REPLICATE", "production_ai", "Replicate"],
    ["FAL.AI", "production_ai", "fal.ai"],
    ["RUNPOD", "production_ai", "RunPod"],
    ["HUGGINGFACE", "production_ai", "Hugging Face"],
    ["Mistral AI", "production_ai", "Mistral AI"],
    ["CAPCUT", "production_ai", "CapCut"],
    ["Cap Cut Pro", "production_ai", "CapCut"],
    ["Freepik", "production_ai", "Freepik"],
    ["Topaz Labs", "production_ai", "Topaz Labs"],
    ["Hedra", "production_ai", "Hedra"],
    ["Magnific", "production_ai", "Magnific"],
    ["Perplexity", "production_ai", "Perplexity"],
    ["Akool", "production_ai", "Akool"],
    ["Epidemic Sound", "production_other", "Epidemic Sound"],
    ["ARTLIST", "production_other", "Artlist"],
    ["Envato Elements", "production_other", "Envato"],
    ["Shutterstock", "production_other", "Shutterstock"],
    ["Adobe Stock", "production_other", "Adobe Stock"],
    // faux amis
    ["VEOLIA EAU", null],
    ["Claude Dupont", null],
    ["Gemini exchange", null],
    ["Le Mistral restaurant", null],
    ["Magnifique", null],
    ["Arcades", null],
    ["Paid ID 123", null],
  ]);
});

test("suggestCategory : domaine, hébergement, logiciels", () => {
  checkExpenses([
    ["NAMECHEAP.COM", "domain_hosting", "Namecheap"],
    ["GODADDY.COM", "domain_hosting", "GoDaddy"],
    ["Go Daddy", "domain_hosting", "GoDaddy"],
    ["CLOUDFLARE", "domain_hosting", "Cloudflare"],
    ["OVH", "domain_hosting", "OVHcloud"],
    ["OVHcloud", "domain_hosting", "OVHcloud"],
    ["Hostinger", "domain_hosting", "Hostinger"],
    ["VERCEL INC.", "domain_hosting", "Vercel"],
    ["AWS EMEA", "domain_hosting", "Amazon Web Services"],
    ["Amazon Web Services", "domain_hosting", "Amazon Web Services"],
    ["GOOGLE*CLOUD", "domain_hosting", "Google Cloud"],
    ["Google Domains", "domain_hosting", "Google Domains"],
    ["DigitalOcean", "domain_hosting", "DigitalOcean"],
    ["Squarespace", "domain_hosting", "Squarespace"],
    ["Wix.com", "domain_hosting", "Wix"],
    ["NOTION LABS", "software", "Notion"],
    ["SLACK", "software", "Slack"],
    ["ZOOM.US 888-799-9666", "software", "Zoom"],
    ["GOOGLE*WORKSPACE", "software", "Google Workspace"],
    ["GSUITE", "software", "Google Workspace"],
    ["CANVA* 12345", "software", "Canva"],
    ["FIGMA", "software", "Figma"],
    ["ADOBE *CREATIVE CLOUD", "software", "Adobe"],
    ["ZAPIER", "software", "Zapier"],
    ["MAKE.COM", "software", "Make"],
    ["TRIPLE WHALE", "software", "Triple Whale"],
    ["Triplewhale", "software", "Triple Whale"],
    ["APPLE.COM/BILL", "software", "Apple"],
    ["GITHUB", "software", "GitHub"],
    ["Calendly", "software", "Calendly"],
    ["Microsoft 365", "software", "Microsoft"],
    ["Motion App", "software", "Motion"],
    // faux amis
    ["Make a wish", null],
    ["Promotion", null],
    ["Canvas print", null],
    ["Description", null],
  ]);
});

test("suggestCategory : freelances et créateurs", () => {
  checkExpenses([
    ["FIVERR", "freelancers", "Fiverr"],
    ["Upwork -123REF", "freelancers", "Upwork"],
    ["Malt", "freelancers", "Malt"],
    ["99designs", "freelancers", "99designs"],
    ["Deel", "freelancers", "Deel"],
    ["Freelance montage video", "freelancers", null],
    ["Monteur vidéo Paul", "freelancers", null],
    // le mot-clé donne la catégorie, le prestataire reconnu dans la même catégorie donne le tiers
    ["Fiverr freelance", "freelancers", "Fiverr"],
    ["Billo", "creators", "Billo"],
    ["Insense", "creators", "Insense"],
    ["JoinBrands", "creators", "JoinBrands"],
    ["Collabstr", "creators", "Collabstr"],
    ["Billo UGC videos", "creators", "Billo"],
    ["UGC vidéo Marie", "creators", null],
    ["Créatrice UGC", "creators", null],
    // payer une personne prime sur le nom de la plateforme cité dans le libellé
    ["UGC TikTok Marie", "creators", null],
    ["Influenceuse Instagram", "creators", null],
  ]);
});

test("suggestCategory : création de LLC, agent enregistré, comptabilité, impôts", () => {
  checkExpenses([
    ["STRIPE ATLAS", "legal_admin", "Stripe Atlas"],
    ["FIRSTBASE.IO", "legal_admin", "Firstbase"],
    ["DOOLA", "legal_admin", "doola"],
    ["LEGALZOOM", "legal_admin", "LegalZoom"],
    ["NORTHWEST REGISTERED AGENT", "legal_admin", "Northwest Registered Agent"],
    ["ZENBUSINESS", "legal_admin", "ZenBusiness"],
    ["INCFILE", "legal_admin", "Bizee (Incfile)"],
    ["HARVARD BUSINESS SERVICES", "legal_admin", "Harvard Business Services"],
    ["Registered Agents Inc", "legal_admin", "Registered Agents Inc"],
    ["Wyoming Agents", "legal_admin", "Wyoming Agents"],
    ["DE DIV OF CORP", "legal_admin", "Delaware Division of Corporations"],
    ["WY SECRETARY OF STATE", "legal_admin", "Secretary of State"],
    ["ANYTIME MAILBOX", "legal_admin", "Anytime Mailbox"],
    ["EARTH CLASS MAIL", "legal_admin", "Earth Class Mail"],
    ["Registered agent annual fee", "legal_admin", null],
    ["QUICKBOOKS", "legal_admin", "QuickBooks"],
    ["INTUIT *QBooks Online", "legal_admin", "QuickBooks"],
    ["INTUIT *TURBOTAX", "legal_admin", "TurboTax"],
    ["XERO", "legal_admin", "Xero"],
    ["Pennylane", "legal_admin", "Pennylane"],
    ["Bench Accounting", "legal_admin", "Bench"],
    ["TaxJar", "legal_admin", "TaxJar"],
    ["Expert-comptable honoraires", "legal_admin", null],
    ["Honoraires avocat", "legal_admin", null],
    ["IRS USATAXPYMT", "taxes", null],
    ["EFTPS", "taxes", null],
    ["Delaware Franchise Tax", "taxes", null],
    ["DGFIP", "taxes", null],
    ["URSSAF", "taxes", null],
    ["Impôts", "taxes", null],
  ]);
});

test("suggestCategory : livraison et impression", () => {
  checkExpenses([
    ["PRINTFUL", "shipping", "Printful"],
    ["USPS PO 123", "shipping", "USPS"],
    ["UPS*1Z999", "shipping", "UPS"],
    ["FEDEX", "shipping", "FedEx"],
    ["DHL EXPRESS", "shipping", "DHL"],
    ["La Poste Colissimo", "shipping", "La Poste"],
    ["Shippo", "shipping", "Shippo"],
    ["Coupons", null],
    ["Startups", null],
    ["Start-ups conseil", null],
  ]);
});

test("suggestCategory : intermédiaires de paiement", () => {
  // derrière PayPal, c'est le vrai prestataire qui compte
  checkExpenses([
    ["PAYPAL *CANVA", "software", "Canva"],
    ["PAYPAL *FIVERR", "freelancers", "Fiverr"],
    ["PAYPAL *FACEBOOK", "ads_meta", "Meta"],
    ["PayPal fee", "fees_payment", "PayPal"],
    ["Frais PayPal", "fees_payment", "PayPal"],
    ["STRIPE", "fees_payment", "Stripe"],
    ["Klarna", "fees_payment", "Klarna"],
    ["Payment processing fee", "fees_payment", null],
    ["Frais de transaction", "fees_payment", null],
    ["Transaction fee", "fees_payment", null],
    // un achat PayPal chez un marchand inconnu : on ne devine pas
    ["PAYPAL *UNKNOWNSHOP", null],
    ["PAYPAL TRANSFER", null],
  ]);
  assert.deepEqual(suggestCategory(null, { label: "PAYPAL TRANSFER", amountCents: 50000 }), { categoryId: "sales_other", party: "PayPal", via: "vendor" });
  assert.deepEqual(suggestCategory(null, { label: "STRIPE PAYOUT", amountCents: 50000 }), { categoryId: "sales_other", party: "Stripe", via: "vendor" });
  assert.equal(suggestCategory(null, { label: "Klarna", amountCents: 50000 }).categoryId, "sales_other");
  // un remboursement d'un prestataire reste dans sa catégorie de dépense
  assert.equal(suggestCategory(null, { label: "Remboursement Klaviyo", amountCents: 2000 }).categoryId, "email_sms");
  assert.equal(suggestCategory(null, { label: "STRIPE ATLAS refund", amountCents: 2000 }).categoryId, "legal_admin");
});

test("suggestCategory : litiges et remboursements clients", () => {
  checkExpenses([
    ["Chargeback order 1234", "chargebacks", null],
    ["Shopify dispute", "chargebacks", null],
    ["Litige carte", "chargebacks", null],
    ["PayPal dispute fee", "chargebacks", null],
    ["Rétrofacturation commande 1001", "chargebacks", null],
    ["Remboursement client commande 1001", "refunds", null],
    ["Refund to customer", "refunds", null],
    ["Customer refund", "refunds", null],
  ]);
});

test("suggestCategory : frais bancaires et de change, mais pas les simples virements", () => {
  checkExpenses([
    ["Revolut Business plan fee", "bank_fees", "Revolut"],
    ["Wise Charges for: TRANSFER-123", "bank_fees", "Wise"],
    ["Frais Wise", "bank_fees", "Wise"],
    ["Slash Pro plan", "bank_fees", "Slash"],
    ["Mercury wire fee", "bank_fees", "Mercury"],
    ["Frais bancaires", "bank_fees", null],
    ["Foreign transaction fee", "bank_fees", null],
    ["International transaction fee", "bank_fees", null],
    ["Commission d'intervention", "bank_fees", null],
    ["FX fee", "bank_fees", null],
    ["Wire fee", "bank_fees", null],
    ["Frais de change", "bank_fees", null],
    ["Cotisation carte", "bank_fees", null],
    ["Monthly fee", "bank_fees", null],
    ["Wise", null],
    ["To Revolut", null],
    ["Slash", null],
    ["Virement vers Revolut", null],
    ["Otherwise", null],
    ["Frais de port", null],
  ]);
});

test("suggestCategory : rien à proposer", () => {
  for (const input of [null, undefined, {}, { label: "" }, { label: "   " }, { label: null, party: null }, { label: "CARTE X1234 COMMERCE INCONNU", amountCents: -500 }]) {
    assert.equal(suggestCategory(null, input), null, JSON.stringify(input));
    assert.equal(suggestCategory(configWith(), input), null, JSON.stringify(input));
  }
});

test("suggestCategory : le tiers sert aussi à reconnaître le prestataire", () => {
  assert.deepEqual(suggestCategory(null, { label: "Paiement carte 0562", party: "Applovin Corporation", amountCents: -9477 }), { categoryId: "ads_applovin", party: "AppLovin", via: "vendor" });
  assert.deepEqual(suggestCategory(null, { party: "Klaviyo Inc" }), { categoryId: "email_sms", party: "Klaviyo", via: "vendor" });
  // mot-clé sans nom propre : le tiers fourni est repris tel quel (espaces nettoyés)
  assert.deepEqual(suggestCategory(null, { label: "UGC novembre", party: "  Marie   Dupont ", amountCents: -15000 }), { categoryId: "creators", party: "Marie Dupont", via: "vendor" });
});

test("suggestCategory : les règles de l'utilisateur passent avant le dictionnaire", () => {
  const config = configWith({
    rules: {
      r1: { id: "r1", contains: "klaviyo", categoryId: "software", accountId: null, order: 0, enabled: true },
    },
  });
  assert.deepEqual(suggestCategory(config, { label: "KLAVIYO INC", amountCents: -100 }), { categoryId: "software", party: "Klaviyo", via: "rule", ruleId: "r1" });
  // sans règle correspondante : le dictionnaire
  assert.deepEqual(suggestCategory(config, { label: "Omnisend", amountCents: -100 }), { categoryId: "email_sms", party: "Omnisend", via: "vendor" });
  // une règle classe aussi ce que le dictionnaire ne connaît pas
  const custom = configWith({ rules: { r1: { id: "r1", contains: "studio lumière", categoryId: "production_other", order: 0, enabled: true } } });
  assert.deepEqual(suggestCategory(custom, { label: "VIR STUDIO LUMIERE SARL", amountCents: -50000 }), { categoryId: "production_other", party: null, via: "rule", ruleId: "r1" });
  assert.deepEqual(suggestCategory(custom, { label: "VIR STUDIO LUMIERE SARL", party: "Studio Lumière", amountCents: -50000 }), { categoryId: "production_other", party: "Studio Lumière", via: "rule", ruleId: "r1" });
  // le sens du montant ne change rien pour une règle
  assert.equal(suggestCategory(custom, { label: "studio lumière", amountCents: 100 }).categoryId, "production_other");
});

test("suggestCategory : règles sans majuscules, sans accents, sans ponctuation, sur le libellé ou le tiers", () => {
  const rule = (contains) => configWith({ rules: { r1: { id: "r1", contains, categoryId: "other_expense", order: 0, enabled: true } } });
  const hits = [
    ["café léa", "CAFE LEA PARIS 11"],
    ["CAFE LEA", "Café Léa"],
    ["Société", "SOCIETE GENERALE"],
    ["google ads", "GOOGLE*ADS123"],
    ["fb.me/ads", "FACEBK *X7Y8Z9 fb.me/ads"],
    ["FB.ME/ADS", "facebk fb.me/ads"],
    ["  klaviyo  ", "Receipt from Klaviyo Inc"],
    ["star", "StarringYou LLC"],
    ["\u0153uvre", "OEUVRE D'ART"],
    ["x1234", "CARTE X1234"],
    ["l'atelier", "L ATELIER DU FILM"],
  ];
  for (const [contains, label] of hits) {
    assert.equal(suggestCategory(rule(contains), { label, amountCents: -1 })?.via, "rule", `${contains} / ${label}`);
    assert.equal(suggestCategory(rule(contains), { label: "CB 21/11", party: label, amountCents: -1 })?.via, "rule", `${contains} / tiers ${label}`);
  }
  const misses = [["klaviyo", "Omnisend"], ["café léa", "CAFE DE LEA"], ["x1234", "CARTE X 1234 5"]];
  for (const [contains, label] of misses) {
    assert.notEqual(suggestCategory(rule(contains), { label, amountCents: -1 })?.via, "rule", `${contains} / ${label}`);
  }
});

test("suggestCategory : ordre des règles, règles désactivées ou incomplètes", () => {
  const config = configWith({
    rules: {
      b: { id: "b", contains: "meta", categoryId: "ads_other", order: 2, enabled: true },
      a: { id: "a", contains: "meta", categoryId: "software", order: 2, enabled: true },
      z: { id: "z", contains: "facebk", categoryId: "other_expense", order: 1, enabled: true },
      off: { id: "off", contains: "meta", categoryId: "taxes", order: 0, enabled: false },
      gone: null,
      empty: { id: "empty", contains: "   ", categoryId: "taxes", order: 0, enabled: true },
      nocat: { id: "nocat", contains: "meta", categoryId: null, order: 0, enabled: true },
      bad: "pas un objet",
    },
  });
  // la règle désactivée, la règle vide et la règle sans catégorie sont ignorées ; à ordre égal, l'identifiant départage
  assert.equal(suggestCategory(config, { label: "Meta Platforms", amountCents: -1 }).ruleId, "a");
  // l'ordre le plus petit gagne quand plusieurs règles correspondent
  assert.equal(suggestCategory(config, { label: "FACEBK *X meta", amountCents: -1 }).ruleId, "z");
  // `enabled` absent vaut activé ; `order` absent vaut 0 ; l'identifiant vient de la clé si besoin
  const loose = configWith({ rules: { k1: { contains: "meta", categoryId: "software" } } });
  assert.deepEqual(suggestCategory(loose, { label: "Meta", amountCents: -1 }), { categoryId: "software", party: "Meta", via: "rule", ruleId: "k1" });
});

test("suggestCategory : une catégorie archivée ou supprimée n'est jamais proposée", () => {
  const config = configWith({ rules: { r1: { id: "r1", contains: "klaviyo", categoryId: "software", order: 0, enabled: true } } });
  config.categories.software.archived = true;
  // la règle est sautée, le dictionnaire prend le relais
  assert.deepEqual(suggestCategory(config, { label: "Klaviyo", amountCents: -1 }), { categoryId: "email_sms", party: "Klaviyo", via: "vendor" });
  config.categories.email_sms.archived = true;
  assert.equal(suggestCategory(config, { label: "Klaviyo", amountCents: -1 }), null);
  // catégorie retirée (null en base)
  const removed = configWith();
  removed.categories.ads_meta = null;
  assert.equal(suggestCategory(removed, { label: "FACEBK *X", amountCents: -1 }), null);
  // règle vers une catégorie inconnue
  const unknown = configWith({ rules: { r1: { id: "r1", contains: "klaviyo", categoryId: "cat_qui_n_existe_pas", order: 0, enabled: true } } });
  assert.equal(suggestCategory(unknown, { label: "Klaviyo", amountCents: -1 }).via, "vendor");
  // règle vers une catégorie créée par l'utilisateur
  const own = configWith({ rules: { r1: { id: "r1", contains: "klaviyo", categoryId: "cat_perso", order: 0, enabled: true } } });
  own.categories.cat_perso = { id: "cat_perso", name: "Perso", kind: "expense", group: "other", archived: false };
  assert.equal(suggestCategory(own, { label: "Klaviyo", amountCents: -1 }).categoryId, "cat_perso");
  // Shopify : si la catégorie d'un sens est archivée, on ne propose rien pour ce sens
  const noSales = configWith();
  noSales.categories.sales_shopify.archived = true;
  assert.equal(suggestCategory(noSales, { label: "Shopify", amountCents: 100 }), null);
  assert.equal(suggestCategory(noSales, { label: "Shopify", amountCents: -100 }).categoryId, "shopify_sub");
});

test("suggestCategory : configuration absente ou partielle", () => {
  const expected = { categoryId: "ads_meta", party: "Meta", via: "vendor" };
  for (const config of [null, undefined, {}, { categories: null }, { rules: null }, { categories: {} }, { rules: [], categories: undefined }]) {
    assert.deepEqual(suggestCategory(config, { label: "FACEBK *X", amountCents: -1 }), expected, JSON.stringify(config));
  }
});

test("suggestCategory : ne modifie ni la configuration ni l'entrée", () => {
  const config = configWith({ rules: { r1: { id: "r1", contains: "klaviyo", categoryId: "software", order: 0, enabled: true } } });
  const before = JSON.stringify(config);
  const input = Object.freeze({ label: "Klaviyo", party: "Klaviyo Inc", amountCents: -100 });
  suggestCategory(config, input);
  suggestAccount(config, { card: "0562", label: "Klaviyo" });
  assert.equal(JSON.stringify(config), before);
});

test("findVendor", () => {
  assert.deepEqual(findVendor({ label: "FACEBK *X7Y8Z9" }), { party: "Meta", categoryId: "ads_meta", positiveCategoryId: null });
  assert.deepEqual(findVendor({ label: "SHOPIFY* 123" }), { party: "Shopify", categoryId: "shopify_sub", positiveCategoryId: "sales_shopify" });
  assert.deepEqual(findVendor({ party: "PayPal" }), { party: "PayPal", categoryId: null, positiveCategoryId: "sales_other" });
  assert.equal(findVendor({ label: "Frais bancaires" }), null);
  assert.equal(findVendor({ label: "CARTE X1234" }), null);
  assert.equal(findVendor(null), null);
  assert.equal(findVendor({}), null);
});

test("suggestAccount : par les 4 derniers chiffres de la carte", () => {
  const config = configWith({
    accounts: {
      perso: { id: "perso", name: "Carte perso", kind: "card", owner: "p1", currency: "EUR", cards: ["0562"], order: 1, archived: false },
      pro: { id: "pro", name: "Slash", kind: "bank", owner: "business", currency: "USD", cards: ["2487", "9911"], order: 0, archived: false },
      vide: { id: "vide", name: "Sans carte", kind: "bank", owner: "business", currency: "USD", order: 2, archived: false },
      nombres: { id: "nombres", name: "Cartes en nombres", kind: "card", owner: "p2", currency: "USD", cards: [77, 1234], order: 3, archived: false },
      supprime: null,
    },
  });
  const table = [
    ["0562", "perso"], ["2487", "pro"], ["9911", "pro"], ["•••• 0562", "perso"], ["xxxx-xxxx-xxxx-2487", "pro"], ["5555 **** **** 0562", "perso"],
    ["- 2487", "pro"], [562, "perso"], ["562", "perso"], [2487, "pro"], ["4242424242420562", "perso"], ["0077", "nombres"], ["1234", "nombres"],
    ["0000", null], ["", null], [null, null], [undefined, null], ["pas de chiffres", null],
  ];
  for (const [card, expected] of table) assert.equal(suggestAccount(config, { card, date: "2026-11-21" }), expected, JSON.stringify(card));
  assert.equal(suggestAccount(config, { card: "0562" }), "perso");
  assert.equal(suggestAccount(config, {}), null);
  assert.equal(suggestAccount(config, null), null);
  assert.equal(suggestAccount(null, { card: "0562" }), null);
  assert.equal(suggestAccount({}, { card: "0562" }), null);
  assert.equal(suggestAccount({ accounts: null }, { card: "0562" }), null);
});

test("suggestAccount : compte archivé, même carte sur deux comptes", () => {
  const config = configWith({
    accounts: {
      ancien: { id: "ancien", name: "Ancien compte", cards: ["0562"], order: 0, archived: true },
      b: { id: "b", name: "B", cards: ["0562"], order: 5, archived: false },
      a: { id: "a", name: "A", cards: ["0562"], order: 5, archived: false },
      c: { id: "c", name: "C", cards: ["0562"], order: 9, archived: false },
    },
  });
  // un compte actif passe avant un compte archivé, puis l'ordre, puis l'identifiant
  assert.equal(suggestAccount(config, { card: "0562" }), "a");
  // s'il ne reste qu'un compte archivé, il est quand même proposé (la carte lui appartient)
  assert.equal(suggestAccount({ accounts: { ancien: config.accounts.ancien } }, { card: "0562" }), "ancien");
});

test("suggestAccount : à défaut de carte, une règle qui porte un compte", () => {
  const config = configWith({
    accounts: {
      perso: { id: "perso", name: "Carte perso", cards: ["0562"], order: 0, archived: false },
      pro: { id: "pro", name: "Slash", cards: ["2487"], order: 1, archived: false },
      ferme: { id: "ferme", name: "Fermé", cards: [], order: 2, archived: true },
    },
    rules: {
      r1: { id: "r1", contains: "applovin", categoryId: "ads_applovin", accountId: "pro", order: 0, enabled: true },
      r2: { id: "r2", contains: "klaviyo", categoryId: "email_sms", accountId: null, order: 1, enabled: true },
      r3: { id: "r3", contains: "vieux", categoryId: "other_expense", accountId: "ferme", order: 2, enabled: true },
      r4: { id: "r4", contains: "fantome", categoryId: "other_expense", accountId: "nexistepas", order: 3, enabled: true },
      r5: { id: "r5", contains: "investisseur", categoryId: null, accountId: "perso", order: 4, enabled: true },
    },
  });
  assert.equal(suggestAccount(config, { label: "APPLOVIN CORPORATION" }), "pro");
  assert.equal(suggestAccount(config, { party: "Applovin Corporation" }), "pro");
  // la carte prime sur la règle
  assert.equal(suggestAccount(config, { card: "0562", label: "APPLOVIN CORPORATION" }), "perso");
  // carte inconnue : la règle reprend la main
  assert.equal(suggestAccount(config, { card: "0000", label: "APPLOVIN CORPORATION" }), "pro");
  assert.equal(suggestAccount(config, { label: "Klaviyo" }), null);
  assert.equal(suggestAccount(config, { label: "Vieux compte" }), null);
  assert.equal(suggestAccount(config, { label: "Fantôme" }), null);
  // une règle sans catégorie peut porter un compte
  assert.equal(suggestAccount(config, { label: "Paiement investisseur" }), "perso");
  assert.equal(suggestAccount(config, { label: "Rien de connu" }), null);
  // la proposition de catégorie rappelle le compte de la règle
  assert.deepEqual(suggestCategory(config, { label: "APPLOVIN CORPORATION", amountCents: -9477 }), { categoryId: "ads_applovin", party: "AppLovin", via: "rule", ruleId: "r1", accountId: "pro" });
});

test("suggestCategory : 20 000 libellés classés vite, y compris des libellés démesurés", () => {
  const config = configWith({
    rules: {
      r1: { id: "r1", contains: "studio lumière", categoryId: "production_other", order: 0, enabled: true },
      r2: { id: "r2", contains: "loyer", categoryId: "other_expense", order: 1, enabled: true },
    },
  });
  const vendors = ["FACEBK *", "TIKTOK ADS ", "APPLOVIN ", "KLAVIYO ", "SHOPIFY* ", "OPENAI *CHATGPT "];
  const started = performance.now();
  let known = 0;
  for (let i = 0; i < 20000; i++) {
    const label = i % 4 === 0 ? vendors[i % vendors.length] + i : "CARTE X" + i + " COMMERCE INCONNU " + i + " PARIS FR";
    if (suggestCategory(config, { label, amountCents: i % 2 ? 1000 : -1000 })) known++;
  }
  assert.equal(known, 5000);
  const huge = "klaviyo ".repeat(100000);
  assert.equal(suggestCategory(config, { label: huge, amountCents: -1 }).categoryId, "email_sms");
  assert.equal(suggestCategory(config, { label: "a".repeat(1000000), amountCents: -1 }), null);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 4000, `trop lent : ${Math.round(elapsed)} ms`);
});

test("le dictionnaire ne cite que des catégories livrées par model.js, et marche avec la configuration par défaut", async () => {
  const { DEFAULT_CATEGORIES, defaultConfig, normalizeConfig, accountForCard } = await import("../../src/core/model.js");
  assert.deepEqual([...CATEGORY_IDS].sort(), Object.keys(DEFAULT_CATEGORIES).sort());
  for (const entry of VENDORS) {
    for (const id of [entry.categoryId, entry.positiveCategoryId]) if (id) assert.ok(DEFAULT_CATEGORIES[id], id);
  }
  const config = defaultConfig();
  assert.deepEqual(suggestCategory(config, { label: "FACEBK *X7Y8Z9", amountCents: -5000 }), { categoryId: "ads_meta", party: "Meta", via: "vendor" });
  assert.deepEqual(suggestCategory(config, { label: "SHOPIFY PAYMENTS", amountCents: 5000 }), { categoryId: "sales_shopify", party: "Shopify", via: "vendor" });
  // règles et comptes passés par normalizeConfig
  const custom = normalizeConfig({
    accounts: {
      perso: { id: "perso", name: "Carte perso", kind: "card", owner: "unknown", currency: "EUR", cards: ["4242 4242 4242 0562"] },
      pro: { id: "pro", name: "Slash", kind: "bank", owner: "business", currency: "USD", cards: [2487] },
    },
    rules: { r1: { contains: "Studio Lumière", categoryId: "production_other", accountId: "pro" } },
  });
  assert.deepEqual(suggestCategory(custom, { label: "VIR STUDIO LUMIERE", amountCents: -100 }), { categoryId: "production_other", party: null, via: "rule", ruleId: "r1", accountId: "pro" });
  for (const card of ["0562", "2487", "9999", "- 2487"]) {
    assert.equal(suggestAccount(custom, { card }), accountForCard(custom, card), card);
  }
  assert.equal(suggestAccount(custom, { label: "Studio Lumière" }), "pro");
});
