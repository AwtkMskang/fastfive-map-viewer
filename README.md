# 무료 좌표 지도 뷰어 (Leaflet + OSM + Supercluster)

내부 20명 사용 기준으로, Google Sheets에 게시된 CSV(좌표 17만+ 포함)를 **무료로** 지도에 클러스터링하여 표시합니다.

## 준비물
- Google Sheets를 **웹에 게시(Publish)** 한 CSV URL
- CSV 헤더에 다음 컬럼이 있으면 자동 인식합니다.
  - 레코드Id (또는 recordId)
  - 위도 (또는 lat/latitude)
  - 경도 (또는 lng/lon/longitude)
  - 대지위치 (선택)
  - status (선택)
  - Salesforce URL (선택: 클릭 시 바로 열기 링크)

## 실행 방법
### 1) 로컬에서 실행(권장: CORS 이슈 방지)
아래 중 하나로 간단 서버를 띄우세요.

- Python:
  - `python -m http.server 8080`
- Node:
  - `npx serve .`

그 다음 브라우저에서:
- `http://localhost:8080`

### 2) CSV URL을 미리 고정하고 싶다면
`index.html` 로드 후 상단에 CSV URL을 붙여넣고 **불러오기**를 누르세요.

또는 URL 파라미터로:
- `.../index.html?csv=<CSV_URL>`

## 배포(무료)
- GitHub Pages 또는 Cloudflare Pages에 이 폴더를 그대로 올리면 됩니다.

## 참고
- OSM 타일은 무료지만, 트래픽이 매우 커지는 공개 서비스라면 정책을 확인하세요.
- status 필터는 개별 포인트에만 적용되어 클러스터 자체는 그대로 표시됩니다.
  - status 기반 클러스터가 필요하면 status=1/0 별도로 인덱스를 2개 생성하는 방식으로 확장 가능합니다.
