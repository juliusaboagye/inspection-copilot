// Azure deployment: Container Apps (api + worker), ACR, Key Vault, PostgreSQL Flexible Server,
// Blob Storage for images, Log Analytics. One user-assigned managed identity; no secrets in code.
//
//   az deployment group create -g rg-inspection -f infra/main.bicep -p pgAdminPassword=<from a vault> apiImage=... workerImage=...

@description('Short prefix for resource names')
param prefix string = 'inspcop'
param location string = resourceGroup().location
@secure()
param pgAdminPassword string
param apiImage string
param workerImage string
@allowed(['fake', 'anthropic', 'openai-compatible'])
param visionProvider string = 'fake'
param entraTenantId string = tenant().tenantId
param entraApiClientId string = ''

var suffix = uniqueString(resourceGroup().id)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${suffix}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-id'
  location: location
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: '${prefix}acr${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${prefix}-kv-${take(suffix, 8)}'
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${prefix}st${suffix}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { allowBlobPublicAccess: false, minimumTlsVersion: 'TLS1_2' }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource imagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'inspection-images'
}

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${prefix}-pg-${suffix}'
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: 'icadmin'
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'ic'
}

// Store the connection string in Key Vault; apps read it through their managed identity.
resource dbSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: {
    value: 'postgres://icadmin:${uriComponent(pgAdminPassword)}@${pg.properties.fullyQualifiedDomainName}:5432/ic?sslmode=require'
  }
}

// Built-in role definition IDs
var acrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var kvSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var blobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPull)
  scope: acr
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPull) }
}
resource kvAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, identity.id, kvSecretsUser)
  scope: kv
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUser) }
}
resource blobAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, identity.id, blobDataContributor)
  scope: storage
  properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributor) }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

var commonSecrets = [
  { name: 'database-url', keyVaultUrl: dbSecret.properties.secretUri, identity: identity.id }
]
var commonEnv = [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'VISION_PROVIDER', value: visionProvider }
  { name: 'AUTH_MODE', value: empty(entraApiClientId) ? 'none' : 'entra' }
  { name: 'ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ENTRA_API_CLIENT_ID', value: entraApiClientId }
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'IMAGE_BLOB_URL', value: '${storage.properties.primaryEndpoints.blob}inspection-images' }
]

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-api'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  dependsOn: [acrPullAssignment, kvAssignment]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: true, targetPort: 3000 }
      registries: [{ server: acr.properties.loginServer, identity: identity.id }]
      secrets: commonSecrets
    }
    template: {
      containers: [{
        name: 'api'
        image: apiImage
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: commonEnv
        probes: [{ type: 'Readiness', httpGet: { path: '/health', port: 3000 } }]
      }]
      scale: { minReplicas: 1, maxReplicas: 5 }
    }
  }
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-worker'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  dependsOn: [acrPullAssignment, kvAssignment]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      registries: [{ server: acr.properties.loginServer, identity: identity.id }]
      secrets: commonSecrets // add the model API key as another Key Vault-referenced secret
    }
    template: {
      containers: [{
        name: 'worker'
        image: workerImage
        command: ['npm', 'run', 'worker', '-w', '@ic/api']
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: concat(commonEnv, [{ name: 'VISION_SAMPLES', value: '3' }])
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

output apiUrl string = 'https://${api.properties.configuration.ingress.fqdn}'
output acrLoginServer string = acr.properties.loginServer
