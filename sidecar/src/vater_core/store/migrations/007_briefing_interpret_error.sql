-- AI 해석이 없는 이유(v2 설계 21장 5번): {"code", "message"} JSON. 해석이 있으면 비어 있다.
ALTER TABLE briefings ADD COLUMN interpret_error TEXT;
