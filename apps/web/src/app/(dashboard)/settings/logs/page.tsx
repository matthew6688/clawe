"use client";

import {
  PageHeader,
  PageHeaderRow,
  PageHeaderTitle,
} from "@dashboard/page-header";
import { SystemLogsSettings } from "./_components/system-logs-settings";

const LogsSettingsPage = () => {
  return (
    <>
      <PageHeader>
        <PageHeaderRow>
          <PageHeaderTitle>Logs</PageHeaderTitle>
        </PageHeaderRow>
      </PageHeader>

      <div className="max-w-6xl">
        <SystemLogsSettings />
      </div>
    </>
  );
};

export default LogsSettingsPage;
