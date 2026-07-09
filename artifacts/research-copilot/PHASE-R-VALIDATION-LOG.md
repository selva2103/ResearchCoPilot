# Phase R — Resolver Debug Log (raw evidence)

Captured from the `Frontend` workflow's stdout while running the 12
representative validation queries against `POST /api/resolve-validate`
(each call logs one line via `logDebug()` in `lib/resolver/index.ts`).

```
[resolver] "Trp53 Mus musculus" → entities=[gene, organism] organism=Mus musculus geneId=22059 confidence=0.97 reason="Gene "Trp53" resolved for organism Mus musculus; no disease context confirmed."
[resolver] "TP53" → entities=[gene, organism] organism=Homo sapiens geneId=7157 confidence=0.92 reason="Gene "TP53" preferred over any disease interpretation: no disease-specific context found beyond the bare symbol."
[resolver] "TP53 breast cancer" → entities=[gene, organism, disease] organism=Homo sapiens geneId=7157 confidence=0.85 reason="Gene "TP53" and disease "breast cancer" both confirmed — context preserved."
[resolver] "BRCA2 human" → entities=[gene, organism] organism=Homo sapiens geneId=675 confidence=0.97 reason="Gene "BRCA2" resolved for organism Homo sapiens; no disease context confirmed."
[resolver] "mouse Cd4" → entities=[gene, organism] organism=Mus musculus geneId=12504 confidence=0.97 reason="Gene "Cd4" resolved for organism Mus musculus; no disease context confirmed."
[resolver] "BARC" → entities=[gene, organism] organism=Drosophila melanogaster geneId=40369 confidence=0.8 reason="Gene "barc" preferred over any disease interpretation: no disease-specific context found beyond the bare symbol."
[resolver] "BRCA" → entities=[gene, organism] organism=Drosophila melanogaster geneId=37916 confidence=0.8 reason="Gene "Brca2" preferred over any disease interpretation: no disease-specific context found beyond the bare symbol."
[resolver] "Hepatitis" → entities=[disease] organism=none geneId=none confidence=0.72 reason="Disease "Hepatitis" resolved via MedGen; no gene-symbol collision detected."
[resolver] "malaria" → entities=[disease] organism=none geneId=none confidence=0.72 reason="Disease "malaria" resolved via MedGen; no gene-symbol collision detected."
[resolver] "p53" → entities=[gene, organism] organism=Homo sapiens geneId=7157 confidence=0.92 reason="Gene "TP53" preferred over any disease interpretation: no disease-specific context found beyond the bare symbol."
[resolver] "Cd4 human" → entities=[gene, organism] organism=Homo sapiens geneId=920 confidence=0.97 reason="Gene "CD4" resolved for organism Homo sapiens; no disease context confirmed."
[resolver] "Cd4 mouse" → entities=[gene, organism] organism=Mus musculus geneId=12504 confidence=0.97 reason="Gene "Cd4" resolved for organism Mus musculus; no disease context confirmed."
```

Source: `Frontend` workflow log, 2026-07-08.
