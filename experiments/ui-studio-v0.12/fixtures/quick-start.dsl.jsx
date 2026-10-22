<Page id="page-demo" name="샘플 화면" gap={20} padding={24}>
  <Column gap={12}>
    <Text id="title" text="UI Studio 테스트" weight="heading" />
    <Row gap={8}>
      <Input id="search" label="검색어" value="{{state.keyword}}" />
      <Button id="go" text="조회" />
    </Row>
    <DataGrid id="users" data="{{sources.customers}}" />
  </Column>
</Page>
