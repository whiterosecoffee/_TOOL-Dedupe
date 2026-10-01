"""
A real, runnable comparison test: does Splink (unsupervised Fellegi-Sunter EM,
no training labels -- the family identified as the right fit for an autonomous
pipeline) find the same near-duplicate relationships our own TF-IDF+union-find
tool found, on the exact same real corpus?

Not a toy example -- loads the actual files from the same Prompts/ directory
already tested in de-dupe's README ("Measured results" section).
"""
import os
import pandas as pd
import splink.comparison_library as cl
from splink import DuckDBAPI, Linker, SettingsCreator
from splink.blocking_rule_library import CustomRule

NO_BLOCKING = CustomRule("1=1")  # small corpus (228 records, ~26k pairs) -- compare everything, no blocking needed

CORPUS_DIR = r"C:\Users\fivet\OneDrive\prompts\Prompts"
EXTENSIONS = {".md", ".txt", ".json", ".mjs", ".js", ".ts"}
IGNORE_DIRS = {"node_modules", ".git", ".claude"}

records = []
for root, dirs, files in os.walk(CORPUS_DIR):
    dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
    for f in files:
        if os.path.splitext(f)[1] in EXTENSIONS:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, CORPUS_DIR).replace("\\", "/")
            try:
                with open(full, "r", encoding="utf-8") as fh:
                    content = fh.read()
            except UnicodeDecodeError:
                continue
            records.append({"unique_id": rel, "content": content})

df = pd.DataFrame(records)
print(f"Loaded {len(df)} records (same corpus as de-dupe's 228-file real test)")

settings = SettingsCreator(
    link_type="dedupe_only",
    comparisons=[cl.JaccardAtThresholds("content", [0.5, 0.9])],
    blocking_rules_to_generate_predictions=[NO_BLOCKING],
    retain_intermediate_calculation_columns=True,
    # Rough manual prior (duplicates are rare among 228 near-arbitrary files) instead of the
    # deterministic-rule estimator, which degenerates when blocking covers literally every pair.
    probability_two_random_records_match=1 / len(df),
)

db_api = DuckDBAPI()
splink_df = db_api.register(df)
linker = Linker(splink_df, settings)

# Unsupervised: u estimated from random sampling, m estimated via EM -- no human labels anywhere.
linker.training.estimate_u_using_random_sampling(max_pairs=1e6)
linker.training.estimate_parameters_using_expectation_maximisation(NO_BLOCKING)

predictions = linker.inference.predict(threshold_match_probability=0.5)
pred_df = predictions.as_pandas_dataframe().sort_values("match_probability", ascending=False)

print(f"\n{len(pred_df)} predicted matches above 0.5 match probability (real Fellegi-Sunter EM, not a guessed threshold)")
print("\nTop 15 predicted matches:")
cols = ["unique_id_l", "unique_id_r", "match_probability"]
print(pred_df[cols].head(15).to_string(index=False))

pred_df[cols].to_csv("splink-predictions.csv", index=False)
print("\nFull predictions written to splink-predictions.csv")
