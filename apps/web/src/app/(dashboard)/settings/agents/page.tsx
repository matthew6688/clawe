"use client";

import {
  PageHeader,
  PageHeaderRow,
  PageHeaderTitle,
} from "@dashboard/page-header";
import { AgentsSettings } from "./_components/agents-settings";

const AgentsSettingsPage = () => {
  return (
    <>
      <PageHeader>
        <PageHeaderRow>
          <PageHeaderTitle>Agents</PageHeaderTitle>
        </PageHeaderRow>
      </PageHeader>

      <div className="max-w-5xl">
        <AgentsSettings />
      </div>
    </>
  );
};

export default AgentsSettingsPage;
