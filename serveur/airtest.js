const Airtable = require("airtable");
const base = new Airtable({ apiKey: "patnf0j0L63L87HMF.08d52d0bf7b44c157091e8b5c513c8078e79d4e6d0033bb33932ec65baeb1afd" }).base("app2KcZXoyufc1Eou");

(async () => {
  try {
    // Récupérer tous les enregistrements
    const records = await base("tbl8oKYhVPy5OET4U").select({}).all();

    console.log(`✅ ${records.length} enregistrements trouvés :\n`);

    records.forEach((record, index) => {
      console.log(`--- Enregistrement ${index + 1} ---`);
      for (const [key, value] of Object.entries(record.fields)) {
        console.log(`${key} = ${value}`);
      }
      console.log("\n");
    });

  } catch (err) {
    console.error("❌ Erreur Airtable:", err);
  }
})();
