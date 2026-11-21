// Classement automatique : à partir du libellé d'un mouvement, proposer une catégorie et un tiers.
// D'abord les règles créées par l'utilisateur (config.rules), puis un dictionnaire intégré de prestataires
// qu'une boutique Shopify de films personnalisés paie en pratique (pub, apps, outils IA, banque, juridique...).

// Catégories livrées avec l'appli (mêmes identifiants que DEFAULT_CATEGORIES dans model.js).
const BUILT_IN_CATEGORY_IDS = new Set([
  "sales_shopify", "sales_other", "refunds", "other_income",
  "ads_meta", "ads_tiktok", "ads_applovin", "ads_google", "ads_other",
  "production_ai", "production_other",
  "shopify_sub", "shopify_apps", "fees_payment", "chargebacks",
  "email_sms", "software", "domain_hosting",
  "creators", "freelancers",
  "bank_fees", "legal_admin", "taxes",
  "shipping", "other_expense",
]);

const MAX_TEXT = 600;

function foldBase(value) {
  if (value == null) return "";
  let s = String(value);
  if (s.length > MAX_TEXT) s = s.slice(0, MAX_TEXT);
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss");
}

/**
 * Texte prêt à comparer : minuscules, sans accents, tout ce qui n'est ni lettre ni chiffre devient une espace.
 * "FACEBK *X7Y8Z9 fb.me/ads" -> "facebk x7y8z9 fb me ads". Limité aux 600 premiers caractères.
 * @param {*} value
 * @returns {string}
 */
export function foldText(value) {
  return foldBase(value).replace(/[^a-z0-9]+/g, " ").trim();
}

// Variante qui garde la ponctuation (pour les règles de l'utilisateur du genre "fb.me/ads").
function foldPlain(value) {
  return foldBase(value).replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ dictionnaire intégré */

const FEE_WORDS = "fees?|frais|charges?|commissions?|cotisation";

// Un nom de banque seul ne dit rien (c'est souvent un virement) : il faut aussi un mot de frais dans le libellé.
// Pour les banques de l'entreprise, "plan" compte aussi ("Revolut Business plan", "Slash Pro plan").
function bankFee(party, names) {
  const words = party ? FEE_WORDS + "|plan" : FEE_WORDS;
  return [party, "^(?=.*\\b(?:" + names + ")\\b)(?=.*\\b(?:" + words + ")\\b)"];
}

// Chaque groupe : [categoryId, positiveCategoryId ou null, liste].
// Un élément de liste est soit un nom (le motif est déduit du nom : "Triple Whale" reconnaît "triplewhale" et "triple whale"),
// soit [nom, motif] ; nom null = simple mot-clé, sans tiers. Les motifs s'appliquent au texte passé par foldText.
// L'ordre compte : la première entrée reconnue donne la catégorie, donc le plus précis d'abord
// et les intermédiaires de paiement (PayPal, Stripe) après les vrais prestataires ("PAYPAL *CANVA" = Canva).
const GROUPS = [
  ["chargebacks", null, [
    [null, "\\b(?:chargebacks?|retrofacturations?|disputes?|litiges?|contestation carte)\\b"],
  ]],
  ["refunds", null, [
    [null, "\\b(?:remboursements?|rembourse|refund|refunds|refunded) (?:du |de la |au |a la |to |of |for )?(?:clients?|cliente|customers?|commandes?|orders?)\\b|\\b(?:customer|client|order) refunds?\\b"],
  ]],

  // Publicité
  ["ads_meta", null, [
    ["Meta", "\\b(?:facebk|facebook(?:ads)?|fb me ads|fb ads|instagram|meta|metaads|meta ?pay)\\b"],
  ]],
  ["ads_tiktok", null, [
    ["TikTok", "\\btik ?tok|\\bbytedance\\b"],
  ]],
  ["ads_applovin", null, [
    ["AppLovin", "\\bapp ?lovin|\\baxon\\b"],
  ]],
  ["ads_google", null, [
    ["Google Ads", "\\bgoogle ?ads(?!ense)|\\bgoogle ?adwords\\b|\\badwords\\b|\\byoutube ads\\b"],
  ]],
  ["ads_other", null, [
    ["Snapchat", "\\bsnapchat\\b|\\bsnap (?:inc|ads)\\b"],
    "Pinterest",
    "Reddit",
    ["X (Twitter)", "\\btwitter\\b|\\bx corp\\b|\\bx ads\\b"],
    ["Microsoft Advertising", "\\b(?:microsoft|bing|msft) ?(?:ads|advertising)\\b"],
    "Taboola", "Outbrain", "Mintegral", "Moloco", "Unity Ads", "Liftoff", "ironSource",
    ["Amazon Ads", "\\b(?:amazon|amzn) ?(?:ads|advertising)\\b"],
    "LinkedIn",
    ["Apple Search Ads", "\\bsearch ads\\b"],
    ["Spotify Ads", "\\bspotify ?ad"],
    "NewsBreak", "Nextdoor", "Quora Ads",
  ]],

  // Shopify : les apps facturées à part, puis Shopify lui-même (abonnement en sortie, virement de ventes en entrée)
  ["shopify_apps", null, [
    "Loox", "Judge.me", "Yotpo", "Okendo",
    ["Stamped", "\\bstamped ?io\\b"],
    "PageFly", "GemPages", "Replo", "Shogun", "Zipify", "ReConvert", "AfterSell", "Rebuy", "Bold Commerce",
    ["Recharge", "\\brecharge ?(?:payments|apps?|subscriptions)\\b|\\brechargepayments\\b"],
    "Skio", "AfterShip", "Parcel Panel", "Track123", "17TRACK", "Customily", "Teeinblue", "Zepto", "Uploadery", "Upload Kit",
    "Product Personalizer", "Kickflip", "Sky Pilot", "SendOwl", "FileFlare", "Filemonk", "Digital Downloads", "Easy Digital Products",
    ["Kaching Bundles", "\\bkaching\\b"],
    "UpCart",
    ["Monster Upsells", "\\bmonster ?(?:upsells?|cart)\\b"],
    "Selleasy", "Candy Rack", "Hextom", "Privy", "Justuno", "Langify", "Transcy", "Booster Theme", "Debutify", "Shrine Theme",
    "Out of the Sandbox",
    ["Vitals", "\\bvitals ?(?:app|io)\\b"],
    "Trackify", "Instafeed", "Tapcart", "Loop Returns", "Matrixify", "Appstle", "Seal Subscriptions", "PushOwl", "Smile.io",
    "Growave", "LoyaltyLion", "Frequently Bought Together", "Fast Bundle", "Releasit", "Avada", "Qikify", "BOGOS", "EComposer", "Foxify",
    ["App Shopify", "\\bshopify ?apps?\\b|\\bshopify ?themes?\\b|\\btheme store\\b"],
  ]],
  ["shopify_sub", "sales_shopify", [
    "Shopify",
  ]],

  // Email et SMS
  ["email_sms", null, [
    "Klaviyo",
    ["Mailchimp", "\\bmail ?chimp\\b"],
    "Omnisend",
    ["SendGrid", "\\bsend ?grid\\b"],
    "Twilio", "Postscript",
    ["Attentive", "\\battentive ?(?:mobile|com|sms)\\b"],
    "Brevo", "Sendinblue", "MailerLite", "ConvertKit", "ActiveCampaign", "Postmark", "Mailgun",
    ["Resend", "\\bresend ?(?:com|inc)\\b"],
    ["SMSBump", "\\bsms ?bump\\b"],
    ["Drip", "\\bdrip ?com\\b|\\bgetdrip\\b"],
    "Customer.io", "Beehiiv", "Substack", "Sendlane", "Recart", "Emotive", "Mailjet", "Amazon SES", "Flodesk",
    ["Instantly", "\\binstantly ?ai\\b"],
    "Lemlist", "Smartlead", "SimpleTexting", "Constant Contact", "GetResponse", "AWeber", "Moosend",
    ["Loops", "\\bloops ?so\\b"],
  ]],

  // Fabrication des films : IA (vidéo, image, voix, musique), calcul, montage
  ["production_ai", null, [
    ["OpenAI", "\\bopen ?ai\\b|\\bchat ?gpt\\b|\\bsora\\b|\\bdall ?e\\b"],
    ["Anthropic", "\\banthropic\\b|\\bclaude ?ai\\b|\\bclaude (?:pro|max|team|code|api|subscription|abonnement)\\b"],
    ["ElevenLabs", "\\beleven ?labs\\b"],
    ["HeyGen", "\\bhey ?gen\\b"],
    ["Runway", "\\brunway ?(?:ml|ai)?\\b"],
    ["Kling AI", "\\bkling ?ai\\b|\\bkling\\b|\\bkuaishou\\b"],
    ["Midjourney", "\\bmid ?journey\\b"],
    "Higgsfield",
    ["Google Veo", "\\bveo ?[0-9]?\\b|\\bgoogle ?(?:flow|labs|ai|gemini)\\b|\\bgemini (?:pro|advanced|ultra|api)\\b|\\bai studio\\b|\\bvertex ?ai\\b"],
    "Suno", "Udio",
    ["Pika", "\\bpika ?(?:labs|art)?\\b"],
    ["Luma AI", "\\bluma ?(?:ai|labs)\\b|\\bdream machine\\b"],
    "Synthesia",
    ["D-ID", "\\bd id\\b"],
    ["Leonardo.Ai", "\\bleonardo ?ai\\b|\\bleonardo interactive\\b"],
    ["Stability AI", "\\bstability ?ai\\b|\\bdream ?studio\\b"],
    "Ideogram", "Krea", "Freepik",
    ["Black Forest Labs", "\\bblack forest labs\\b|\\bbfl ?ai\\b"],
    "Replicate", "fal.ai", "RunPod", "Together AI", "Hugging Face", "Civitai", "Magnific", "Topaz Labs", "Hedra",
    ["MiniMax (Hailuo)", "\\bminimax\\b|\\bhailuo\\b"],
    "Vidu", "PixVerse", "Viggle", "Kaiber", "Genmo", "Haiper", "InVideo", "Arcads", "Creatify", "MakeUGC", "Topview", "Perplexity",
    ["xAI (Grok)", "\\bxai\\b|\\bgrok\\b"],
    ["Mistral AI", "\\bmistral\\b"],
    "DeepSeek", "OpenRouter", "Groq", "Cohere",
    ["Poe", "\\bpoe ?com\\b|\\bquora poe\\b"],
    ["LALAL.AI", "\\blalal\\b"],
    "remove.bg", "PhotoRoom", "Clipdrop", "Akool", "Reface", "DeepSwap", "Magic Hour", "Vidnoz", "Pollo AI", "WaveSpeed", "Segmind",
    ["ComfyUI", "\\bcomfy ?(?:ui|deploy|org|cloud)\\b"],
    "ThinkDiffusion", "RunDiffusion", "Tensor.Art", "SeaArt", "PiAPI", "Kie.ai",
    ["AI/ML API", "\\baimlapi\\b"],
    "Novita", "DeepInfra", "Fireworks AI",
    ["Modal", "\\bmodal ?(?:labs|com)\\b"],
    "Lambda Labs", "Vast.ai", "CoreWeave", "Paperspace",
    ["PlayHT", "\\bplay ?ht\\b"],
    "Murf", "Resemble AI", "Cartesia", "Speechify", "WellSaid", "LOVO", "Fish Audio", "Soundraw", "Mubert", "AIVA", "Beatoven",
    ["CapCut", "\\bcap ?cut\\b"],
    "VEED", "Kapwing", "Descript", "Submagic",
    ["Opus Clip", "\\bopus ?clip\\b|\\bopus pro\\b"],
    ["Captions", "\\bcaptions ?(?:ai|app)\\b"],
  ]],
  ["production_other", null, [
    "Epidemic Sound", "Artlist", "Soundstripe", "Musicbed",
    ["Envato", "\\benvato\\b|\\baudiojungle\\b|\\bvideohive\\b"],
    "Motion Array", "Storyblocks", "Shutterstock", "Adobe Stock", "iStock", "Getty Images", "Pond5",
  ]],

  // Domaine et hébergement
  ["domain_hosting", null, [
    "Namecheap",
    ["GoDaddy", "\\bgo ?daddy\\b"],
    "Cloudflare",
    ["OVHcloud", "\\bovh(?:cloud)?\\b"],
    "Gandi", "Hostinger",
    ["IONOS", "\\bionos\\b|\\b1and1\\b"],
    "Squarespace", "Google Domains", "Porkbun", "Name.com", "Dynadot", "Vercel", "Netlify", "Heroku", "DigitalOcean",
    ["Amazon Web Services", "\\bamazon web services\\b|\\baws\\b"],
    ["Google Cloud", "\\bgoogle ?cloud\\b|\\bgcp\\b"],
    ["Microsoft Azure", "\\bazure\\b"],
    ["Render", "\\brender ?com\\b"],
    "Fly.io",
    ["Railway", "\\brailway ?(?:app|corp)\\b"],
    "Bluehost", "SiteGround", "o2switch", "Wix", "Webflow", "Supabase", "Firebase",
    ["Bunny.net", "\\bbunny ?(?:net|cdn|way)\\b"],
    ["Mux", "\\bmux ?(?:com|inc|video)\\b"],
    "Cloudinary", "Backblaze", "Hetzner", "Linode", "Vultr", "Scaleway", "Infomaniak", "WP Engine", "Kinsta", "Framer", "Carrd",
  ]],

  // Freelances et créateurs
  ["freelancers", null, [
    "Fiverr", "Upwork", "Malt", "Freelancer.com", "99designs", "Toptal",
    ["ComeUp", "\\bcomeup\\b|\\b5 ?euros\\b"],
    "PeoplePerHour",
    ["OnlineJobs.ph", "\\bonlinejobs\\b"],
    ["Contra", "\\bcontra ?com\\b"],
    "Deel", "Voices.com", "Voice123", "Bunny Studio", "Legiit", "Workana", "Codeur.com",
  ]],
  ["creators", null, [
    "Billo", "Insense", "Trend.io", "JoinBrands", "Collabstr", "Influee", "SideShift", "Twirl", "minisocial", "Popular Pays",
    ["Aspire", "\\baspire ?(?:iq|io)\\b"],
    "Upfluence", "Modash", "Social Cat",
    ["#paid", "\\bhashtag ?paid\\b"],
    "Creator.co", "Backstage",
    ["GRIN", "\\bgrin ?(?:co|technologies)\\b"],
    [null, "\\bugc\\b|\\binfluenceu(?:r|se)s?\\b|\\binfluencers?\\b|\\bcontent creators?\\b|\\bcreat(?:eur|rice)s? (?:ugc|de contenu)\\b"],
  ]],
  ["freelancers", null, [
    [null, "\\bfreelances?\\b|\\bfreelancers?\\b|\\bprestataires?\\b|\\bmonteu(?:r|se) video\\b|\\bvideo editors?\\b"],
  ]],

  // Impôts, puis juridique, création de LLC, agent enregistré, comptabilité
  ["taxes", null, [
    [null, "\\birs\\b|\\beftps\\b|\\bus treasury\\b|\\bfranchise tax\\b|\\bstate tax\\b|\\bsales tax\\b|\\btax payment\\b|\\bdgfip\\b|\\bimpots?\\b|\\burssaf\\b|\\bcomptroller\\b"],
  ]],
  ["legal_admin", null, [
    "Stripe Atlas", "Firstbase", "doola", "LegalZoom",
    ["Northwest Registered Agent", "\\bnorthwest registered\\b|\\bnw registered\\b|\\bnorthwest agent\\b"],
    "ZenBusiness",
    ["Bizee (Incfile)", "\\bbizee\\b|\\bincfile\\b"],
    ["Harvard Business Services", "\\bharvard business\\b"],
    ["Registered Agents Inc", "\\bregistered agents? inc\\b"],
    "Clerky", "Tailor Brands", "Rocket Lawyer",
    ["Wyoming Agents", "\\bwyoming (?:registered )?agents?\\b"],
    ["InCorp", "\\bincorp ?services\\b"],
    "CT Corporation", "Cogency Global", "CorpNet", "StartGlobal", "Globalfy",
    ["Delaware Division of Corporations", "\\b(?:delaware|de) div(?:ision)? of corp"],
    ["Secretary of State", "\\bsecretary of state\\b|\\bsec of state\\b"],
    "Anytime Mailbox", "Earth Class Mail", "iPostal1",
    ["Virtual Post Mail", "\\bvirtual ?post ?mail\\b"],
    "PostScan Mail", "US Global Mail", "Traveling Mailbox", "Termly", "iubenda",
    ["USPTO", "\\buspto\\b"],
    "LegalStart", "LegalPlace", "Captain Contrat",
    ["Infogreffe", "\\binfogreffe\\b|\\bgreffe\\b"],
    ["INPI", "\\binpi\\b"],
    ["QuickBooks", "\\bquick ?books\\b|\\bintuit\\b"],
    "Xero",
    ["Bench", "\\bbench ?(?:accounting|co)\\b"],
    ["Pilot", "\\bpilot ?com\\b"],
    "FreshBooks",
    ["Wave", "\\bwave ?(?:apps|financial|accounting)\\b"],
    "Pennylane", "Tiime", "Dougs", "Zoho Books", "TaxJar", "Avalara",
    ["Collective", "\\bcollective ?(?:com|hub)\\b"],
    ["Fondo", "\\bfondo\\b|\\btryfondo\\b"],
    ["1-800Accountant", "\\b1 ?800 ?accountant\\b"],
    "TurboTax", "Taxfyle",
    ["A2X", "\\ba2x\\b"],
    "Link My Books", "Synder", "Finaloop",
    [null, "\\bregistered agent\\b|\\bannual report\\b|\\bllc (?:formation|filing|registration|annual)\\b|\\barticles of organization\\b|\\bcertificate of (?:formation|good standing|incorporation)\\b|\\bexpert ?comptable\\b|\\bcomptable\\b|\\baccountant\\b|\\bbookkeep(?:er|ing)\\b|\\bcpa\\b|\\bavocate?\\b|\\blawyer\\b|\\battorney\\b|\\bnotaire\\b"],
  ]],

  // Logiciels et abonnements
  ["software", null, [
    "Notion", "Slack",
    ["Zoom", "\\bzoom ?(?:us|video|com|pro)?\\b"],
    ["Google Workspace", "\\bgoogle ?workspace\\b|\\bg ?suite\\b"],
    ["Microsoft", "\\bmicrosoft\\b|\\boffice ?365\\b|\\bmsft\\b"],
    "Dropbox", "Canva", "Figma", "Adobe", "Airtable", "Zapier",
    ["Make", "\\bmake ?com\\b|\\bintegromat\\b"],
    "n8n", "Calendly", "Loom", "Trello", "Asana", "ClickUp", "monday.com", "1Password", "LastPass", "Dashlane", "Bitwarden",
    "NordVPN", "ExpressVPN", "Surfshark", "GitHub", "GitLab", "Cursor",
    ["Linear", "\\blinear ?app\\b"],
    "Typeform",
    ["Tally", "\\btally ?so\\b"],
    "Jotform", "Intercom", "Zendesk", "Gorgias",
    ["Crisp", "\\bcrisp ?(?:chat|im)\\b"],
    "Tidio", "Freshdesk", "Help Scout", "Triple Whale", "Hyros", "Northbeam", "Polar Analytics", "Lifetimely", "Elevar", "Stape",
    "Cometly", "Minea", "Foreplay", "AdSpy", "PiPiADS", "BigSpy",
    ["Atria", "\\batria ?(?:ai|com)\\b|\\btryatria\\b"],
    "Trendtrack", "Semrush", "Ahrefs", "Hotjar", "Lucky Orange", "Grammarly", "Trustpilot", "Vimeo", "Wistia", "Frame.io", "Weglot",
    ["Apple", "\\bapple ?com ?bill\\b|\\bitunes\\b|\\bicloud\\b|\\bapp ?store\\b"],
    ["Google One", "\\bgoogle ?(?:one|storage|play)\\b"],
    "DocuSign", "PandaDoc", "HelloSign", "ManyChat",
    ["HighLevel", "\\b(?:go)?high ?level\\b"],
    "Linktree", "Hootsuite", "Metricool", "Setapp", "Raycast", "Superhuman", "Discord", "Replit", "Lovable", "Miro",
    ["Wondershare", "\\bwondershare\\b|\\bfilmora\\b"],
    ["Blackmagic Design", "\\bblackmagic\\b|\\bdavinci resolve\\b"],
    ["Final Cut Pro", "\\bfinal cut\\b"],
    ["Motion", "\\bmotion ?app\\b"],
  ]],

  // Livraison et impression
  ["shipping", null, [
    "Printful", "Printify", "Gelato", "Gooten", "Prodigi", "Shippo", "ShipStation", "Pirate Ship", "EasyPost", "Sendcloud",
    ["USPS", "\\busps\\b"],
    ["UPS", "\\bups\\b"],
    "FedEx",
    ["DHL", "\\bdhl\\b"],
    ["La Poste", "\\bla poste\\b|\\bcolissimo\\b"],
    "Chronopost", "Mondial Relay", "Stamps.com", "Vistaprint",
    ["MOO", "\\bmoo ?(?:com|print)\\b"],
    "Sticker Mule", "Packlink", "Boxtal",
  ]],

  // Paiement : frais en sortie, encaissement de ventes en entrée
  ["fees_payment", null, [
    ["PayPal", "^(?=.*\\bpaypal\\b)(?=.*\\b(?:fees?|frais|commissions?)\\b)"],
  ]],
  [null, "sales_other", [
    "PayPal",
  ]],
  ["fees_payment", "sales_other", [
    "Stripe", "Klarna", "Afterpay", "Affirm", "Sezzle", "Gumroad", "Lemon Squeezy", "Whop",
    ["Paddle", "\\bpaddle ?(?:com|net)\\b"],
  ]],
  ["fees_payment", null, [
    [null, "\\bpayment processing\\b|\\bprocessing fees?\\b|\\bfrais de paiement\\b|\\btransaction fees?\\b|\\bfrais de transaction\\b"],
  ]],

  // Banque et change
  ["bank_fees", null, [
    bankFee("Wise", "wise|transferwise"),
    bankFee("Revolut", "revolut"),
    bankFee("Slash", "slash"),
    bankFee("Mercury", "mercury"),
    bankFee("Payoneer", "payoneer"),
    bankFee("Qonto", "qonto"),
    bankFee(null, "n26|relay|brex|bunq|boursorama|boursobank|shine|airwallex|chase|bank of america|wells fargo|bnp|societe generale|credit agricole|lcl|cic|caisse d epargne|banque populaire|banque postale"),
    [null, "\\bfrais bancaires?\\b|\\bfrais de tenue\\b|\\btenue de compte\\b|\\bfrais de change\\b|\\bfrais (?:de |sur )?virement\\b|\\bfrais (?:de )?carte\\b|\\bcommission d intervention\\b|\\bcotisation carte\\b|\\bagios\\b|\\boverdraft\\b|\\b(?:bank|foreign transaction|international transaction|intl transaction|non sterling transaction|fx|exchange|currency conversion|conversion|wire|transfer|monthly|maintenance|service|plan|card|atm) (?:fees?|charges?)\\b"],
  ]],
];

function defaultPattern(name) {
  return "\\b" + foldText(name).split(" ").join(" ?") + "\\b";
}

function buildVendors() {
  const out = [];
  for (const [categoryId, positiveCategoryId, list] of GROUPS) {
    for (const item of list) {
      const party = Array.isArray(item) ? item[0] : item;
      const pattern = Array.isArray(item) ? item[1] : defaultPattern(item);
      out.push(Object.freeze({ re: new RegExp(pattern), party, categoryId, positiveCategoryId }));
    }
  }
  return Object.freeze(out);
}

/**
 * Dictionnaire intégré, dans l'ordre d'essai. Chaque entrée : { re, party, categoryId, positiveCategoryId }.
 * - `re` se teste sur un texte passé par foldText (minuscules, sans accents, sans ponctuation).
 * - `party` : nom propre du prestataire, ou null pour un simple mot-clé ("frais bancaires", "ugc"...).
 * - `categoryId` : catégorie quand l'argent sort (ou quand le sens est inconnu) ; null = pas de proposition dans ce sens.
 * - `positiveCategoryId` : catégorie quand l'argent entre ; null = la même que categoryId (un remboursement du prestataire).
 */
export const VENDORS = buildVendors();

/* ------------------------------------------------------------------ recherche */

const matchCache = new Map();
const MATCH_CACHE_MAX = 4000;

// Rangs de toutes les entrées du dictionnaire reconnues dans le texte (déjà normalisé), dans l'ordre.
function matchIndexes(text) {
  if (!text) return [];
  let hit = matchCache.get(text);
  if (hit) return hit;
  hit = [];
  for (let i = 0; i < VENDORS.length; i++) if (VENDORS[i].re.test(text)) hit.push(i);
  if (matchCache.size >= MATCH_CACHE_MAX) matchCache.clear();
  matchCache.set(text, hit);
  return hit;
}

function vendorText(input) {
  const label = foldText(input && input.label);
  const party = foldText(input && input.party);
  return label && party ? label + " " + party : label || party;
}

function categoryUsable(config, categoryId) {
  if (!categoryId) return false;
  const categories = config && config.categories;
  if (!categories || typeof categories !== "object") return true;
  const category = categories[categoryId];
  if (category == null) return category === undefined && BUILT_IN_CATEGORY_IDS.has(categoryId);
  return !category.archived;
}

function cleanParty(party) {
  if (party == null) return null;
  const s = String(party).replace(/\s+/g, " ").trim();
  return s || null;
}

/**
 * Prestataire connu du dictionnaire intégré, à partir du libellé et/ou du tiers.
 * @param {{ label?: string, party?: string }} input
 * @returns {{ party: string, categoryId: string|null, positiveCategoryId: string|null } | null}
 */
export function findVendor(input) {
  for (const i of matchIndexes(vendorText(input))) {
    const v = VENDORS[i];
    if (v.party) return { party: v.party, categoryId: v.categoryId, positiveCategoryId: v.positiveCategoryId };
  }
  return null;
}

function sortedRules(config) {
  const rules = config && config.rules;
  if (!rules || typeof rules !== "object") return [];
  const list = [];
  for (const key of Object.keys(rules)) {
    const rule = rules[key];
    if (!rule || typeof rule !== "object" || rule.enabled === false) continue;
    if (typeof rule.contains !== "string" || !rule.contains.trim()) continue;
    list.push({ ...rule, id: rule.id || key });
  }
  return list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Règles de l'utilisateur reconnues dans le libellé ou le tiers, dans l'ordre (sans tenir compte des majuscules ni des accents).
function matchingRules(config, input) {
  const rules = sortedRules(config);
  if (!rules.length) return rules;
  const plain = [foldPlain(input && input.label), foldPlain(input && input.party)].filter(Boolean);
  const squashed = [foldText(input && input.label), foldText(input && input.party)].filter(Boolean);
  if (!plain.length) return [];
  return rules.filter((rule) => {
    const needle = foldPlain(rule.contains);
    if (needle && plain.some((text) => text.includes(needle))) return true;
    const loose = foldText(rule.contains);
    return !!loose && squashed.some((text) => text.includes(loose));
  });
}

/**
 * Propose une catégorie (et un tiers) pour un mouvement.
 * 1. Les règles de l'utilisateur (config.rules, par `order` puis par identifiant) : `contains` est cherché dans le libellé
 *    et dans le tiers, sans tenir compte des majuscules, des accents ni de la ponctuation ("google ads" reconnaît "GOOGLE*ADS123").
 * 2. Sinon le dictionnaire intégré VENDORS. Le sens du montant compte : une entrée d'argent venant de Shopify est un virement
 *    de ventes (sales_shopify), une sortie est l'abonnement (shopify_sub) ; une entrée venant d'une régie pub est un
 *    remboursement, classé dans la même catégorie de dépense.
 * Une catégorie archivée ou supprimée n'est jamais proposée.
 * @param {object} config
 * @param {{ label?: string, party?: string, amountCents?: number }} input amountCents signé (négatif = sortie) ; absent = sortie
 * @returns {{ categoryId: string, party: string|null, via: "rule"|"vendor", ruleId?: string, accountId?: string } | null}
 */
export function suggestCategory(config, input) {
  if (!input) return null;
  const indexes = matchIndexes(vendorText(input));
  let vendorParty = null;
  for (const i of indexes) if (VENDORS[i].party) { vendorParty = VENDORS[i].party; break; }

  for (const rule of matchingRules(config, input)) {
    if (!categoryUsable(config, rule.categoryId)) continue;
    const out = { categoryId: rule.categoryId, party: vendorParty || cleanParty(input.party), via: "rule", ruleId: rule.id };
    if (rule.accountId) out.accountId = rule.accountId;
    return out;
  }

  const positive = Number(input.amountCents) > 0;
  for (const i of indexes) {
    const v = VENDORS[i];
    const categoryId = positive && v.positiveCategoryId ? v.positiveCategoryId : v.categoryId;
    if (!categoryUsable(config, categoryId)) continue;
    return { categoryId, party: v.party || vendorParty || cleanParty(input.party), via: "vendor" };
  }
  return null;
}

function last4(card) {
  if (card == null) return null;
  const digits = String(card).replace(/[^0-9]/g, "");
  if (!digits) return null;
  return digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, "0");
}

/**
 * Propose le compte d'un mouvement.
 * D'abord par les 4 derniers chiffres de la carte (config.accounts[id].cards), en préférant un compte non archivé ;
 * sinon par une règle de l'utilisateur qui porte un `accountId` et dont le texte est reconnu dans le libellé ou le tiers.
 * @param {object} config
 * @param {{ card?: string|number, date?: string, label?: string, party?: string }} input `date` est accepté mais pas encore utilisé
 * @returns {string|null} identifiant du compte, ou null
 */
export function suggestAccount(config, input) {
  if (!input) return null;
  const accounts = config && config.accounts && typeof config.accounts === "object" ? config.accounts : {};
  const wanted = last4(input.card);
  if (wanted) {
    const hits = [];
    for (const key of Object.keys(accounts)) {
      const account = accounts[key];
      if (!account || !Array.isArray(account.cards)) continue;
      if (account.cards.some((c) => last4(c) === wanted)) hits.push({ id: account.id || key, archived: !!account.archived, order: Number(account.order) || 0 });
    }
    if (hits.length) {
      hits.sort((a, b) => Number(a.archived) - Number(b.archived) || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return hits[0].id;
    }
  }
  for (const rule of matchingRules(config, input)) {
    if (!rule.accountId) continue;
    const account = accounts[rule.accountId];
    if (account && !account.archived) return rule.accountId;
  }
  return null;
}
