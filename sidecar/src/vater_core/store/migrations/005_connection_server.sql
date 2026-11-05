-- 005: 한투 연결이 어느 서버(실전·모의)의 계좌인지 (core/broker-kis, v2 설계 1장).
-- 서버를 바꾼 뒤 실계좌번호가 모의 서버로 가거나, 모의 서버의 빈 응답이 실제 보유를 지우는 일을 막는다.
ALTER TABLE connections ADD COLUMN server TEXT;
