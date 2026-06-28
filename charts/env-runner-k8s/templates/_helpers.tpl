{{- define "env-runner-k8s.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "env-runner-k8s.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "env-runner-k8s.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "env-runner-k8s.labels" -}}
app.kubernetes.io/name: {{ include "env-runner-k8s.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "env-runner-k8s.selectorLabels" -}}
app.kubernetes.io/name: {{ include "env-runner-k8s.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Name of the Secret holding the env token, and the key within it. */}}
{{- define "env-runner-k8s.tokenSecret" -}}
{{- if .Values.envToken.existingSecret -}}
{{- .Values.envToken.existingSecret -}}
{{- else -}}
{{- printf "%s-token" (include "env-runner-k8s.fullname" .) -}}
{{- end -}}
{{- end -}}
