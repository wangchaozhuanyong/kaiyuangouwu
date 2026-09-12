import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialog';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import '../../src/index.css';
import { IcloudRelayModule } from '../../src/pages/Plugins/IcloudRelayModule';
import { createIcloudContractFixture } from './fixture';

const { client } = createIcloudContractFixture();
createRoot(document.getElementById('root')!).render(
    React.createElement(
        ApolloProvider,
        { client },
        React.createElement(
            ConfirmDialogProvider,
            null,
            React.createElement(FeatureHelpProvider, null, React.createElement(IcloudRelayModule)),
        ),
    ),
);
