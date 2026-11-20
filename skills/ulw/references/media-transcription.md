# OCR / STT 절차

모델은 `model-routing.json`의 `roles.tool_first`를 따른다(Neon 정책).
호스트의 오디오 입력·전사 호출 경로는 [미확인]; 실행 전 지원 여부를 확인한다.
OCR은 세션 모델로 읽고 외부 반출 불가 자료는 Apple Vision으로 로컬 처리한다.
금액·전화·계좌·날짜는 두 번째 엔진과 대조한다.
STT는 라우팅된 Neon 모델과 로컬 faster-whisper large-v3-turbo + VAD 결과를 대조한다.
로컬 설치·VAD 및 클라우드 경로는 [미확인]; 사용할 수 없으면 미검증 구간을 표시한다.
Google 웹 STT recognize_google은 사용하지 않는다. VAD 없는 whisper.cpp는 사용하지 않는다.
서로 다른 구간·숫자를 표시하고, 증거용 녹취록의 숫자·고유명사는 사람이 원음과 대조한다.
시간은 `MM분 SS초` 또는 `MM:SS` 정수로 표기한다.
