SELECT 
    al.id, 
    al.description, 
    al.store_id, 
    s.name as store_name,
    al.created_at,
    p.full_name as performer
FROM activity_logs al
JOIN stores s ON al.store_id = s.id
JOIN profiles p ON al.performer_id = p.id
ORDER BY al.created_at DESC;

SELECT * FROM activity_evidences;
