-- Complaints with complainant and assigned officer (JOIN)
SELECT c.id,c.title,c.status,p.name AS complainant,o.name AS officer
FROM complaints c JOIN complainants p ON p.id=c.complainant_id
JOIN officers o ON o.id=c.officer_id;
-- Workload summary (GROUP BY)
SELECT o.name,COUNT(c.id) AS assigned FROM officers o
LEFT JOIN complaints c ON c.officer_id=o.id GROUP BY o.id;
-- Evidence counts including complaints with no evidence
SELECT c.id,c.title,COUNT(e.id) AS evidence_count FROM complaints c
LEFT JOIN evidence e ON e.complaint_id=c.id GROUP BY c.id;
-- Current recorded custodian of every evidence item (correlated subquery)
SELECT e.id,e.label,o.name,h.location FROM evidence e
JOIN custody h ON h.id=(SELECT MAX(h2.id) FROM custody h2 WHERE h2.evidence_id=e.id)
JOIN officers o ON o.id=h.officer_id;
-- Read evidence metadata without reading large BLOB contents
SELECT id,complaint_id,label,filename,sha256 FROM evidence;
