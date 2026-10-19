# Lab 52 — Architecture notes

## Current architecture

Legend:
- **Boxes inside boxes** = "runs inside" boundaries (hardware → hypervisor → VM → k3s → Pods → containers).
- **Solid arrows** = traffic path used from my laptop.
- **Dashed arrows** = in-cluster traffic paths.

```mermaid
flowchart TB
  subgraph HW["Host hardware — my laptop (Windows)"]
    browser["Browser / PowerShell<br/>(Windows host OS)"]

    subgraph HV["Hypervisor — VirtualBox (NAT, port 2222 → 22)"]
      subgraph VM["Ubuntu 26.04 VM <code>devops-vm</code> — guest kernel 7.0 — single k3s node"]
        pf["kubectl port-forward<br/>127.0.0.1:8080 (VM loopback, temporary)"]

        subgraph K3S["k3s / containerd — namespace quote-lab"]
          svcApp["Service quote-app<br/>ClusterIP :80 → 3000"]
          svcDb["Service quote-db<br/>ClusterIP :5432"]

          subgraph DEPAPP["Deployment quote-app → ReplicaSet (3 replicas)"]
            p1["Pod quote-app-…<br/>container quote-app (Node.js :3000)"]
            p2["Pod quote-app-…<br/>container quote-app"]
            p3["Pod quote-app-…<br/>container quote-app"]
          end

          subgraph DEPDB["Deployment quote-db (1 replica, Recreate)"]
            db["Pod quote-db-…<br/>container postgres:18 :5432"]
          end

          pvc[("PVC quote-db-data 1Gi<br/>StorageClass local-path<br/>= a directory on the VM disk")]
          check["Pod service-check<br/>(busybox test client)"]
          secret["Secret quote-db-secret<br/>ConfigMap quote-db-init"]
        end
      end
    end
  end

  browser -- "SSH tunnel / VS Code Ports<br/>localhost:8080 → VM 127.0.0.1:8080" --> pf
  pf -- "port-forward to the Service<br/>selects ONE Pod (no load balancing)" --> p1
  check -. "wget http://quote-app/health<br/>(cluster DNS + Service)" .-> svcApp
  svcApp -.-> p1 & p2 & p3
  p1 & p2 & p3 -. "DATABASE_URL<br/>quote-db:5432" .-> svcDb
  svcDb -.-> db
  db --- pvc
  secret -. "env / init.sql" .-> db
```

> PostgreSQL status: **deployed and verified** / **planned** ← keep the one that is true.

## Evidence

- Lab 42 verification (health requests, 3 replicas, Pod replacement, readiness failure/recovery): [../42-kubernetes/verification.md](../42-kubernetes/verification.md)
- PVC status: `quote-db-data   Bound   …` ← paste
- Database Pod before replacement: `quote-db-…` ← paste
- Database Pod after `rollout restart`: `quote-db-…` ← paste
- Quote marker: `res509-…` found before **and** after the database Pod replacement ← paste the two `grep` results

## Boundaries

**Shared kernel.** All containers on this node (app and PostgreSQL) are Linux processes isolated by namespaces and cgroups, but they share the Ubuntu VM's guest kernel; the hypervisor (VirtualBox) provides the stronger VM boundary, and Kubernetes only manages workloads inside that VM.

**Persistence and failure boundary.** App Pods are stateless, so the ReplicaSet can replace one with a new name without losing anything; the quote survives a database Pod replacement because the data lives in the PVC, not in the container, and the new Pod mounts the same volume. However, the three replicas and the `local-path` volume all live on one VM and one disk: losing the VM or its disk loses every replica and the data, so recovery from that would need backups and a multi-node / replicated storage design, which this teaching cluster does not provide (future work).

## Next action / main limitation

- ← e.g. "Single node and local-path storage are single points of failure; next step: database backups." or the current blocker if something is unfinished.