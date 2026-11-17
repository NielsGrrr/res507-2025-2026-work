# Lab 42 — Verification

Environment: single-node k3s `v1.36.5+k3s1` (containerd) on Ubuntu 26.04 VM `devops-vm`, namespace `quote-lab`.
Image: `docker.io/library/quote-app:local`, imported into k3s with `docker save | sudo k3s ctr images import -`.

> Lines marked **TODO** must be replaced with real output from my VM before review.

## 1. Health requests

**Forwarded** (`kubectl port-forward svc/quote-app 8080:80`, then from a second VM terminal):

```
$ curl --fail --show-error --max-time 5 http://127.0.0.1:8080/health
TODO {"ok":true}
```

**In-cluster** (busybox client Pod `service-check`, cluster DNS + Service):

```
$ kubectl exec service-check -- wget -qO- http://quote-app/health
TODO {"ok":true}
```

The port-forward goes to one Pod only; the in-cluster request goes through the Service and its ready endpoints.

## 2. Three Ready replicas

`deployment.yaml` requests `replicas: 3`:

```
$ kubectl get pods -l app=quote-app -o wide
NAME                         READY   STATUS    RESTARTS   AGE   IP           NODE
quote-app-69fbbcff49-kwzh8   1/1     Running   0          11m   10.42.0.14   devops-vm
quote-app-69fbbcff49-mfv5j   1/1     Running   0          9s    10.42.0.16   devops-vm
quote-app-69fbbcff49-xj275   1/1     Running   0          9s    10.42.0.17   devops-vm
```

## 3. Pod replacement (reconciliation)

```
$ kubectl delete pod quote-app-69fbbcff49-xj275
pod "quote-app-69fbbcff49-xj275" deleted from quote-lab namespace

$ kubectl get pods -l app=quote-app
NAME                         READY   STATUS    RESTARTS   AGE
quote-app-69fbbcff49-h2fnf   1/1     Running   0          7s
quote-app-69fbbcff49-kwzh8   1/1     Running   0          12m
quote-app-69fbbcff49-mfv5j   1/1     Running   0          76s
```

- Deleted: `quote-app-69fbbcff49-xj275` → replacement: `quote-app-69fbbcff49-h2fnf` (new name, same ReplicaSet hash `69fbbcff49`).
- The ReplicaSet saw 2 Pods instead of the desired 3 and created a new one.

## 4. Deliberate readiness failure

Change: readiness probe path `/health` → `/does-not-exist` (image, port and replicas unchanged).

```
$ kubectl rollout status deployment/quote-app --timeout=60s
Waiting for deployment "quote-app" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition

$ kubectl get pods -l app=quote-app
NAME                         READY   STATUS    RESTARTS   AGE
quote-app-57b88c776b-d5wkg   0/1     Running   0          60s
quote-app-69fbbcff49-h2fnf   1/1     Running   0          114s
quote-app-69fbbcff49-kwzh8   1/1     Running   0          14m
quote-app-69fbbcff49-mfv5j   1/1     Running   0          3m3s

$ kubectl get rs -l app=quote-app
NAME                   DESIRED   CURRENT   READY
quote-app-57b88c776b   1         1         0
quote-app-69fbbcff49   3         3         3
```

**Probe failure event** (`kubectl describe pod quote-app-57b88c776b-d5wkg`):

```
Readiness:      http-get http://:3000/does-not-exist delay=3s timeout=1s period=5s #success=1 #failure=3
Ready:          False
Restart Count:  0
Warning  Unhealthy  1s (x19 over 88s)  kubelet  Readiness probe failed: HTTP probe failed with statuscode: 404
```

**App logs** (the app is running and answers, but the route does not exist):

```
INFO: Route GET:/does-not-exist not found
INFO: request completed  res: { "statusCode": 404 }
```

**Endpoint readiness** (`kubectl get endpointslices -l kubernetes.io/service-name=quote-app -o yaml`):

```
TODO  targetRef.name: quote-app-57b88c776b-d5wkg   conditions.ready: false
TODO  targetRef.name: quote-app-69fbbcff49-...     conditions.ready: true   (x3)
```

The container stays `Running` with `Restart Count: 0`: a failing readiness probe removes the Pod from Service traffic, it does not restart it. The old ReplicaSet keeps 3 Ready Pods, so the Service keeps working while the rollout is stalled.

## 5. Recovery

Probe path restored to `/health`, then `kubectl apply -f deployment.yaml`:

```
TODO $ kubectl rollout status deployment/quote-app --timeout=120s
TODO deployment "quote-app" successfully rolled out
TODO $ kubectl get pods -l app=quote-app      (3 Pods 1/1)
TODO $ kubectl exec service-check -- wget -qO- http://quote-app/health
TODO {"ok":true}
```

## Symptom / cause / fix

- **Symptom:** the rollout timed out; the new Pod `quote-app-57b88c776b-d5wkg` was `Running` but `0/1` Ready, with `Restart Count: 0`.
- **Cause:** the readiness probe path was changed to `/does-not-exist`; the app has no such route and answers HTTP 404, so the kubelet reported `Readiness probe failed … statuscode: 404` and the Pod was never marked Ready.
- **Fix:** restored the readiness path to `/health`, which returns `200 {"ok":true}`; the probe succeeds, the new Pods become Ready and the rollout completes with 3 Ready replicas. The probe was kept, not removed.

## Extension — Lane F: multi-stage validation (dev / staging)

**Change:**
- New route `GET /version` in `labs/20-containerized-node-app/app/app.js`, returning `{"version": <package.json version>}`.
- Two images: `quote-app:v1` (package version `1.0.0`) and `quote-app:v2` (package version `1.1.0`), both imported into k3s.
- Two namespaces `dev` and `staging`, with their own manifests in `dev/` (image `quote-app:v1`) and `staging/` (image `quote-app:v2`); same resource names, no `namespace:` hardcoded, applied with an explicit `-n`.

**Verification:**

```
TODO $ kubectl get deployment quote-app -n dev -o wide        → IMAGES quote-app:v1
TODO $ kubectl get deployment quote-app -n staging -o wide    → IMAGES quote-app:v2

# kubectl port-forward -n dev svc/quote-app 8081:80
# kubectl port-forward -n staging svc/quote-app 8082:80
TODO $ curl http://127.0.0.1:8081/version   → {"version":"1.0.0"}
TODO $ curl http://127.0.0.1:8082/version   → {"version":"1.1.0"}
```

**What it demonstrates:**
- Two environments run different image versions side by side; the image tag shows what was deployed, `/version` shows what actually runs.
- Separation: distinct namespaces (same names, no conflict), distinct manifest folders, explicit `-n` on every command, immutable tags (no `latest`), distinct local ports.
- Limit: namespaces separate names and scope, not network traffic (a dev Pod can reach `quote-app.staging.svc.cluster.local`; NetworkPolicies would be needed), and both environments share the same single node.
- CI/CD: a pipeline builds one immutable image per commit, deploys it to dev, runs checks (`/health`, `/version`), then promotes the same tag to staging; only configuration differs between environments. Here these steps were done by hand.